using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using Shb.Cad.Core;
using Teigha.DatabaseServices;
using Teigha.Geometry;
using CoreApp = Bricscad.ApplicationServices.Application;
using AcException = Teigha.Runtime.Exception;

namespace Shb.Thcad.Extractor
{
    internal static class DrawingExtractor
    {
        const int MaxPolylineVertices = 20000;
        const int MaxSplinePoints = 8000;
        const int MaxDictionaryDepth = 8;
        const string SchemaVersion = "1";
        const string SourceTag = "thcad_v24_dotnet";

        public static string Extract(Database db, string outputRoot)
        {
            if (db == null)
            {
                throw new ArgumentNullException("db");
            }

            string sourcePath = db.Filename ?? "";
            string drawingId = SafeStem(string.IsNullOrWhiteSpace(sourcePath) ? "unnamed" : sourcePath);
            string outDir = Path.Combine(outputRoot, drawingId);
            Directory.CreateDirectory(outDir);

            var startedAt = DateTime.UtcNow;
            var typeCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            var layerCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            var ownerCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            var decodeCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            int entityCount = 0;
            int proxyCount = 0;
            int failedCount = 0;
            var titleBlocks = new List<Dictionary<string, object>>();
            var bomRows = new List<Dictionary<string, object>>();
            var otherPcBlocks = new List<Dictionary<string, object>>();
            var professionalEntities = new List<Dictionary<string, object>>();
            var frameLineSegments = new List<DrawingFrameSegment>();
            var zoneTextSamples = new List<DrawingZoneTextSample>();
            var bomObservations = new List<MechanicalBomRowObservation>();
            var technicalRequirementTexts = new List<TechnicalRequirementTextObservation>();
            var layerEntityObservations = new List<CadLayerEntityObservation>();
            var bodyCenterlineLines = new List<BodyCenterlineLineObservation>();
            var bodyCenterlineTexts = new List<BodyCenterlineTextObservation>();

            string entitiesPath = Path.Combine(outDir, "entities.jsonl");
            string proxiesPath = Path.Combine(outDir, "proxies.jsonl");
            string dictPath = Path.Combine(outDir, "dictionaries.jsonl");
            string errorsPath = Path.Combine(outDir, "errors.jsonl");

            Dictionary<string, object> tables;
            List<Dictionary<string, object>> blockInventory;

            using (var entities = NewWriter(entitiesPath))
            using (var proxies = NewWriter(proxiesPath))
            using (var dictionaries = NewWriter(dictPath))
            using (var errors = NewWriter(errorsPath))
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                tables = DumpTables(db, tr, out blockInventory);

                BlockTable bt = (BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead);
                foreach (ObjectId btrId in bt)
                {
                    BlockTableRecord btr = (BlockTableRecord)tr.GetObject(btrId, OpenMode.ForRead);
                    string ownerScope = OwnerScope(btr);
                    foreach (ObjectId entId in btr)
                    {
                        entityCount++;
                        Entity ent = null;
                        try
                        {
                            ent = tr.GetObject(entId, OpenMode.ForRead, false) as Entity;
                            if (ent == null)
                            {
                                failedCount++;
                                WriteLine(errors, Map(
                                    "handle", HandleOf(entId),
                                    "owner_block_name", btr.Name,
                                    "error", "not_an_entity"));
                                continue;
                            }

                            var modelLine = ent as Line;
                            if (modelLine != null)
                            {
                                bodyCenterlineLines.Add(new BodyCenterlineLineObservation(
                                    HandleOf(modelLine),
                                    Safe(() => modelLine.Layer) as string ?? "",
                                    ownerScope,
                                    btr.Name,
                                    modelLine.StartPoint.X,
                                    modelLine.StartPoint.Y,
                                    modelLine.EndPoint.X,
                                    modelLine.EndPoint.Y));
                            }
                            if (modelLine != null && ownerScope == "model_space")
                            {
                                frameLineSegments.Add(new DrawingFrameSegment(
                                    HandleOf(modelLine),
                                    Safe(() => modelLine.Layer) as string ?? "",
                                    modelLine.StartPoint.X,
                                    modelLine.StartPoint.Y,
                                    modelLine.EndPoint.X,
                                    modelLine.EndPoint.Y));
                            }

                            if (ownerScope == "model_space")
                            {
                                DrawingZoneTextSample zoneText = ZoneTextSampleOf(ent);
                                if (zoneText != null)
                                {
                                    zoneTextSamples.Add(zoneText);
                                }
                            }

                            Dictionary<string, object> record = SerializeEntity(ent, btr, ownerScope, tr);
                            layerEntityObservations.Add(CadLayerEntityObservationOf(record));
                            BodyCenterlineTextObservation bodyCenterlineText =
                                BodyCenterlineTextObservationOf(record);
                            if (bodyCenterlineText != null)
                            {
                                bodyCenterlineTexts.Add(bodyCenterlineText);
                            }
                            if (ownerScope == "model_space")
                            {
                                TechnicalRequirementTextObservation technicalText =
                                    TechnicalRequirementTextObservationOf(record);
                                if (technicalText != null)
                                {
                                    technicalRequirementTexts.Add(technicalText);
                                }
                            }
                            string runtime = Convert.ToString(record["runtime_class"]) ?? "unknown";
                            string layer = Convert.ToString(record["layer"]) ?? "";
                            string decode = Convert.ToString(record["decode_status"]) ?? "full";
                            Bump(typeCounts, runtime);
                            Bump(layerCounts, layer.Length == 0 ? "(empty)" : layer);
                            Bump(ownerCounts, ownerScope);
                            Bump(decodeCounts, decode);

                            CollectSemantic(
                                record,
                                ent,
                                titleBlocks,
                                bomRows,
                                otherPcBlocks,
                                professionalEntities,
                                bomObservations);
                            WriteLine(entities, record);
                            if (decode == "proxy")
                            {
                                proxyCount++;
                                WriteLine(proxies, record);
                            }
                        }
                        catch (System.Exception ex)
                        {
                            failedCount++;
                            WriteLine(errors, Map(
                                "handle", HandleOf(entId),
                                "owner_block_name", btr.Name,
                                "error_type", ex.GetType().Name,
                                "error", Clip(ex.Message, 2048)));
                        }
                    }
                }

                DumpNamedObjects(db, tr, dictionaries);
                tr.Commit();
            }

            DrawingFrameDetectionResult frameDetection = DrawingFrameDetector.Detect(frameLineSegments);
            Dictionary<string, object> frameDetectionMap = frameDetection.ToMap();
            var zoneDetectionResults = new List<DrawingZoneDetectionResult>();
            var zoneDetectionSystems = new List<Dictionary<string, object>>();
            var technicalRequirementFrames = new List<TechnicalRequirementsFrameBounds>();
            var bodyCenterlineFrames = new List<BodyCenterlineFrameBounds>();
            int detectedZoneSystemCount = 0;
            int detectedZoneCount = 0;
            foreach (DrawingFrameCandidate frame in frameDetection.OutermostFrames)
            {
                technicalRequirementFrames.Add(new TechnicalRequirementsFrameBounds(
                    frame.Id,
                    frame.MinX,
                    frame.MinY,
                    frame.MaxX,
                    frame.MaxY));
                bodyCenterlineFrames.Add(new BodyCenterlineFrameBounds(
                    frame.Id,
                    frame.MinX,
                    frame.MinY,
                    frame.MaxX,
                    frame.MaxY));
                var frameBounds = new DrawingZoneFrameBounds(
                    frame.Id,
                    frame.MinX,
                    frame.MinY,
                    frame.MaxX,
                    frame.MaxY);
                DrawingZoneDetectionResult zoneResult = DrawingZoneDetector.Detect(
                    frameBounds,
                    zoneTextSamples);
                zoneDetectionResults.Add(zoneResult);
                zoneDetectionSystems.Add(zoneResult.ToMap());
                if (zoneResult.System.IsDetected)
                {
                    detectedZoneSystemCount++;
                    detectedZoneCount += zoneResult.System.Columns.Count
                        * zoneResult.System.Rows.Count;
                }
            }
            Dictionary<string, object> zoneDetectionMap = Map(
                "schema_version", SchemaVersion,
                "detector", "drawing_zone_detector",
                "source_text_count", zoneTextSamples.Count,
                "frame_count", frameDetection.OutermostFrames.Count,
                "detected_system_count", detectedZoneSystemCount,
                "detected_zone_count", detectedZoneCount,
                "systems", zoneDetectionSystems);
            MechanicalBomKnowledgeDocument bomKnowledge = MechanicalBomKnowledgeBuilder.Build(
                drawingId,
                bomObservations);
            Dictionary<string, object> bomKnowledgeMap = bomKnowledge.ToMap();
            var bomZoneLocations = new List<Dictionary<string, object>>();
            foreach (MechanicalBomTableKnowledge table in bomKnowledge.Tables)
            {
                foreach (DrawingZoneDetectionResult zoneResult in zoneDetectionResults)
                {
                    DrawingZoneLocation location = zoneResult.System.LocateBounds(
                        table.MinX,
                        table.MinY,
                        table.MaxX,
                        table.MaxY);
                    if (location.IntersectsFrame)
                    {
                        bomZoneLocations.Add(Map(
                            "table_id", table.Id,
                            "frame_id", zoneResult.System.Frame.FrameId,
                            "location", location.ToMap()));
                        break;
                    }
                }
            }
            bomKnowledgeMap["zone_locations"] = bomZoneLocations;
            TechnicalRequirementsDocument technicalRequirements =
                TechnicalRequirementsExtractor.Extract(
                    drawingId,
                    technicalRequirementFrames,
                    technicalRequirementTexts);
            Dictionary<string, object> technicalRequirementsMap = technicalRequirements.ToMap();
            var technicalRequirementZoneLocations = new List<Dictionary<string, object>>();
            foreach (TechnicalRequirementsSection section in technicalRequirements.Sections)
            {
                foreach (DrawingZoneDetectionResult zoneResult in zoneDetectionResults)
                {
                    DrawingZoneLocation location = zoneResult.System.LocateBounds(
                        section.MinX,
                        section.MinY,
                        section.MaxX,
                        section.MaxY);
                    if (location.IntersectsFrame)
                    {
                        technicalRequirementZoneLocations.Add(Map(
                            "section_id", section.Id,
                            "frame_id", zoneResult.System.Frame.FrameId,
                            "location", location.ToMap()));
                        break;
                    }
                }
            }
            technicalRequirementsMap["zone_locations"] = technicalRequirementZoneLocations;
            List<CadLayerDefinitionObservation> layerDefinitions = LayerDefinitionsOf(tables);
            CadLayerAnalysisDocument layerAnalysis = CadLayerAnalyzer.Analyze(
                drawingId,
                layerDefinitions,
                layerEntityObservations);
            Dictionary<string, object> layerAnalysisMap = layerAnalysis.ToMap();
            List<BodyCenterlineLayerObservation> bodyCenterlineLayers =
                BodyCenterlineLayerDefinitionsOf(tables);
            BodyCenterlineAnalysisDocument bodyCenterlineAnalysis =
                BodyCenterlineAnalyzer.Analyze(
                    drawingId,
                    bodyCenterlineFrames,
                    bodyCenterlineLayers,
                    bodyCenterlineLines,
                    bodyCenterlineTexts);
            Dictionary<string, object> bodyCenterlineAnalysisMap =
                bodyCenterlineAnalysis.ToMap();
            int offLayerCount = 0;
            int frozenLayerCount = 0;
            int lockedLayerCount = 0;
            foreach (CadLayerSummary layer in layerAnalysis.Layers)
            {
                if (layer.IsOff)
                {
                    offLayerCount++;
                }
                if (layer.IsFrozen)
                {
                    frozenLayerCount++;
                }
                if (layer.IsLocked)
                {
                    lockedLayerCount++;
                }
            }

            var drawing = Map(
                "schema_version", SchemaVersion,
                "drawing_id", drawingId,
                "source_path", sourcePath,
                "filename", string.IsNullOrEmpty(sourcePath) ? "" : Path.GetFileName(sourcePath),
                "source", SourceTag,
                "tile_mode", db.TileMode,
                "measurement", db.Measurement.ToString(),
                "insunits", db.Insunits.ToString(),
                "original_file_version", db.OriginalFileVersion.ToString(),
                "last_saved_as_version", db.LastSavedAsVersion.ToString(),
                "frame_detection", frameDetectionMap,
                "zone_detection", zoneDetectionMap,
                "block_inventory", blockInventory);

            var report = Map(
                "schema_version", SchemaVersion,
                "source", SourceTag,
                "drawing_id", drawingId,
                "source_path", sourcePath,
                "source_sha256", TryHash(sourcePath),
                "source_size_bytes", TrySize(sourcePath),
                "started_at", startedAt,
                "completed_at", DateTime.UtcNow,
                "elapsed_ms", Math.Round((DateTime.UtcNow - startedAt).TotalMilliseconds, 1),
                "host", HostInfo(),
                "entity_count", entityCount,
                "proxy_count", proxyCount,
                "failed_count", failedCount,
                "did_not_save", true,
                "type_counts", typeCounts,
                "layer_counts", layerCounts,
                "owner_scope_counts", ownerCounts,
                "decode_status_counts", decodeCounts,
                "semantic_title_blocks", titleBlocks.Count,
                "semantic_bom_rows", bomRows.Count,
                "semantic_pc_blocks", otherPcBlocks.Count,
                "semantic_professional_entities", professionalEntities.Count,
                "drawing_frame_candidate_count", frameDetection.Candidates.Count,
                "outermost_drawing_frame_count", frameDetection.OutermostFrames.Count,
                "drawing_area_frame_count", frameDetection.OutermostFrames.Count,
                "drawing_zone_system_count", detectedZoneSystemCount,
                "drawing_zone_count", detectedZoneCount,
                "mechanical_bom_table_count", bomKnowledge.Tables.Count,
                "mechanical_bom_row_count", bomKnowledge.RowCount,
                "technical_requirements_section_count", technicalRequirements.Sections.Count,
                "technical_requirements_item_count", technicalRequirements.ItemCount,
                "layer_definition_count", layerAnalysis.DefinedLayerCount,
                "used_layer_definition_count", layerAnalysis.UsedDefinedLayerCount,
                "unused_layer_definition_count", layerAnalysis.UnusedDefinedLayerNames.Count,
                "off_layer_count", offLayerCount,
                "frozen_layer_count", frozenLayerCount,
                "locked_layer_count", lockedLayerCount,
                "layer_suppressed_model_entity_count", layerAnalysis.LayerSuppressedModelEntityCount,
                "body_centerline_axis_candidate_count", bodyCenterlineAnalysis.AxisCandidates.Count,
                "body_centerline_axis_system_candidate_count",
                    bodyCenterlineAnalysis.AxisSystemCandidates.Count,
                "body_centerline_has_explicit_model_evidence",
                    bodyCenterlineAnalysis.HasExplicitModelEvidence,
                "output_dir", outDir);

            var semantic = Map(
                "schema_version", SchemaVersion,
                "source", SourceTag,
                "drawing_id", drawingId,
                "title_blocks", titleBlocks,
                "bom_rows", bomRows,
                "bom_knowledge", bomKnowledgeMap,
                "technical_requirements", technicalRequirementsMap,
                "other_pc_blocks", otherPcBlocks,
                "professional_entities", professionalEntities);

            AtomicWrite(Path.Combine(outDir, "drawing.json"), JsonUtil.Serialize(drawing));
            AtomicWrite(Path.Combine(outDir, "drawing-frames.json"), JsonUtil.Serialize(frameDetectionMap));
            AtomicWrite(Path.Combine(outDir, "drawing-zones.json"), JsonUtil.Serialize(zoneDetectionMap));
            AtomicWrite(Path.Combine(outDir, "bom-knowledge.json"), JsonUtil.Serialize(bomKnowledgeMap));
            AtomicWrite(
                Path.Combine(outDir, "technical-requirements.json"),
                JsonUtil.Serialize(technicalRequirementsMap));
            AtomicWrite(
                Path.Combine(outDir, "technical-requirements.md"),
                technicalRequirements.ToMarkdown());
            AtomicWrite(
                Path.Combine(outDir, "layer-analysis.json"),
                JsonUtil.Serialize(layerAnalysisMap));
            AtomicWrite(
                Path.Combine(outDir, "layer-analysis.md"),
                layerAnalysis.ToMarkdown());
            AtomicWrite(
                Path.Combine(outDir, "body-centerline-analysis.json"),
                JsonUtil.Serialize(bodyCenterlineAnalysisMap));
            AtomicWrite(
                Path.Combine(outDir, "body-centerline-analysis.md"),
                bodyCenterlineAnalysis.ToMarkdown());
            AtomicWrite(Path.Combine(outDir, "tables.json"), JsonUtil.Serialize(tables));
            AtomicWrite(Path.Combine(outDir, "semantic-objects.json"), JsonUtil.Serialize(semantic));
            AtomicWrite(Path.Combine(outDir, "extraction-report.json"), JsonUtil.Serialize(report));
            return Path.Combine(outDir, "extraction-report.json");
        }

        public static string ExtractSelection(
            Database db,
            IList<ObjectId> selectedIds,
            string outputRoot)
        {
            if (db == null)
            {
                throw new ArgumentNullException("db");
            }

            if (selectedIds == null)
            {
                throw new ArgumentNullException("selectedIds");
            }

            string sourcePath = db.Filename ?? "";
            string drawingId = SafeStem(string.IsNullOrWhiteSpace(sourcePath) ? "unnamed" : sourcePath);
            DateTime startedAt = DateTime.UtcNow;
            string captureId = startedAt.ToString("yyyyMMddTHHmmssfffZ", CultureInfo.InvariantCulture);
            string outDir = Path.Combine(outputRoot, drawingId, captureId);
            if (Directory.Exists(outDir))
            {
                outDir += "-" + Guid.NewGuid().ToString("N").Substring(0, 8);
            }
            Directory.CreateDirectory(outDir);

            var typeCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            var layerCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            var ownerCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            var decodeCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            var requestedHandles = new List<string>(selectedIds.Count);
            var serializedHandles = new List<string>(selectedIds.Count);
            var titleBlocks = new List<Dictionary<string, object>>();
            var bomRows = new List<Dictionary<string, object>>();
            var otherPcBlocks = new List<Dictionary<string, object>>();
            var professionalEntities = new List<Dictionary<string, object>>();
            int serializedCount = 0;
            int proxyCount = 0;
            int failedCount = 0;

            foreach (ObjectId id in selectedIds)
            {
                requestedHandles.Add(HandleOf(id));
            }

            string entitiesPath = Path.Combine(outDir, "entities.jsonl");
            string proxiesPath = Path.Combine(outDir, "proxies.jsonl");
            string errorsPath = Path.Combine(outDir, "errors.jsonl");

            using (var entities = NewWriter(entitiesPath))
            using (var proxies = NewWriter(proxiesPath))
            using (var errors = NewWriter(errorsPath))
            using (Transaction tr = db.TransactionManager.StartTransaction())
            {
                for (int selectionIndex = 0; selectionIndex < selectedIds.Count; selectionIndex++)
                {
                    ObjectId entId = selectedIds[selectionIndex];
                    try
                    {
                        Entity ent = tr.GetObject(entId, OpenMode.ForRead, false) as Entity;
                        if (ent == null)
                        {
                            failedCount++;
                            WriteLine(errors, Map(
                                "selection_index", selectionIndex,
                                "handle", HandleOf(entId),
                                "error", "not_an_entity"));
                            continue;
                        }

                        BlockTableRecord owner = tr.GetObject(
                            ent.OwnerId,
                            OpenMode.ForRead,
                            false) as BlockTableRecord;
                        if (owner == null)
                        {
                            failedCount++;
                            WriteLine(errors, Map(
                                "selection_index", selectionIndex,
                                "handle", HandleOf(entId),
                                "error", "owner_is_not_block_table_record"));
                            continue;
                        }

                        string ownerScope = OwnerScope(owner);
                        Dictionary<string, object> record = SerializeEntity(ent, owner, ownerScope, tr);
                        record["selection_index"] = selectionIndex;
                        record["selection_source"] = "pickfirst";

                        string runtime = Convert.ToString(record["runtime_class"]) ?? "unknown";
                        string layer = Convert.ToString(record["layer"]) ?? "";
                        string decode = Convert.ToString(record["decode_status"]) ?? "full";
                        Bump(typeCounts, runtime);
                        Bump(layerCounts, layer.Length == 0 ? "(empty)" : layer);
                        Bump(ownerCounts, ownerScope);
                        Bump(decodeCounts, decode);

                        CollectSemantic(
                            record,
                            ent,
                            titleBlocks,
                            bomRows,
                            otherPcBlocks,
                            professionalEntities);
                        WriteLine(entities, record);
                        serializedHandles.Add(HandleOf(ent));
                        serializedCount++;

                        if (decode == "proxy")
                        {
                            proxyCount++;
                            WriteLine(proxies, record);
                        }
                    }
                    catch (System.Exception ex)
                    {
                        failedCount++;
                        WriteLine(errors, Map(
                            "selection_index", selectionIndex,
                            "handle", HandleOf(entId),
                            "error_type", ex.GetType().Name,
                            "error", Clip(ex.Message, 2048)));
                    }
                }

                tr.Commit();
            }

            DateTime completedAt = DateTime.UtcNow;
            var selection = Map(
                "schema_version", SchemaVersion,
                "source", SourceTag,
                "selection_source", "pickfirst",
                "drawing_id", drawingId,
                "source_path", sourcePath,
                "filename", string.IsNullOrEmpty(sourcePath) ? "" : Path.GetFileName(sourcePath),
                "captured_at", startedAt,
                "requested_count", selectedIds.Count,
                "requested_handles", requestedHandles,
                "serialized_count", serializedCount,
                "serialized_handles", serializedHandles);

            var report = Map(
                "schema_version", SchemaVersion,
                "source", SourceTag,
                "selection_source", "pickfirst",
                "drawing_id", drawingId,
                "source_path", sourcePath,
                "source_size_bytes", TrySize(sourcePath),
                "started_at", startedAt,
                "completed_at", completedAt,
                "elapsed_ms", Math.Round((completedAt - startedAt).TotalMilliseconds, 1),
                "host", HostInfo(),
                "requested_count", selectedIds.Count,
                "serialized_count", serializedCount,
                "proxy_count", proxyCount,
                "failed_count", failedCount,
                "did_not_save", true,
                "type_counts", typeCounts,
                "layer_counts", layerCounts,
                "owner_scope_counts", ownerCounts,
                "decode_status_counts", decodeCounts,
                "semantic_title_blocks", titleBlocks.Count,
                "semantic_bom_rows", bomRows.Count,
                "semantic_pc_blocks", otherPcBlocks.Count,
                "semantic_professional_entities", professionalEntities.Count,
                "output_dir", outDir);

            var semantic = Map(
                "schema_version", SchemaVersion,
                "source", SourceTag,
                "drawing_id", drawingId,
                "selection_source", "pickfirst",
                "title_blocks", titleBlocks,
                "bom_rows", bomRows,
                "other_pc_blocks", otherPcBlocks,
                "professional_entities", professionalEntities);

            string reportPath = Path.Combine(outDir, "selection-report.json");
            AtomicWrite(Path.Combine(outDir, "selection.json"), JsonUtil.Serialize(selection));
            AtomicWrite(Path.Combine(outDir, "semantic-objects.json"), JsonUtil.Serialize(semantic));
            AtomicWrite(reportPath, JsonUtil.Serialize(report));
            AtomicWrite(
                Path.Combine(outputRoot, "_latest-selection.json"),
                JsonUtil.Serialize(Map(
                    "completed_at", completedAt,
                    "drawing_id", drawingId,
                    "requested_count", selectedIds.Count,
                    "serialized_count", serializedCount,
                    "failed_count", failedCount,
                    "report_path", reportPath)));
            return reportPath;
        }

        static Dictionary<string, object> SerializeEntity(
            Entity ent,
            BlockTableRecord owner,
            string ownerScope,
            Transaction tr)
        {
            bool isProxy = ent.IsAProxy || ent is ProxyEntity;
            var record = new Dictionary<string, object>(StringComparer.Ordinal)
            {
                { "drawing_handle", HandleOf(ent.Id) },
                { "handle", HandleOf(ent) },
                { "runtime_class", RxName(ent) },
                { "managed_type", ent.GetType().Name },
                { "dxf_name", Safe(() => ent.GetRXClass().DxfName) },
                { "semantic_type", null },
                { "layer", Safe(() => ent.Layer) },
                { "color", ColorOf(ent) },
                { "linetype", Safe(() => ent.Linetype) },
                { "lineweight", Safe(() => (int)ent.LineWeight) },
                { "visible", Safe(() => ent.Visible) },
                { "owner_scope", ownerScope },
                { "owner_block_name", owner.Name },
                { "owner_handle", HandleOf(owner) },
                { "block_path", new[] { owner.Name } },
                { "bbox", BBoxOf(ent) },
                { "geometry", GeometryOf(ent, tr) },
                { "text", TextOf(ent) },
                { "attributes", AttributesOf(ent, tr) },
                { "xdata", XDataOf(ent) },
                { "extension_dictionary", ExtDictOf(ent, tr) },
                { "source", SourceTag },
                { "decode_status", isProxy ? "proxy" : "full" }
            };

            var proxy = ent as ProxyEntity;
            if (proxy != null)
            {
                record["proxy"] = Map(
                    "original_class_name", Safe(() => proxy.OriginalClassName),
                    "original_dxf_name", Safe(() => proxy.OriginalDxfName),
                    "application_description", Safe(() => proxy.ApplicationDescription),
                    "proxy_flags", Safe(() => (int)proxy.ProxyFlags));
            }

            return record;
        }

        static Dictionary<string, object> GeometryOf(Entity ent, Transaction tr)
        {
            try
            {
                var line = ent as Line;
                if (line != null)
                {
                    return Map("kind", "line", "start", Pt(line.StartPoint), "end", Pt(line.EndPoint));
                }

                var circle = ent as Circle;
                if (circle != null)
                {
                    return Map("kind", "circle", "center", Pt(circle.Center), "radius", circle.Radius,
                        "normal", Pt(circle.Normal));
                }

                var arc = ent as Arc;
                if (arc != null)
                {
                    return Map("kind", "arc", "center", Pt(arc.Center), "radius", arc.Radius,
                        "start_angle", arc.StartAngle, "end_angle", arc.EndAngle, "normal", Pt(arc.Normal));
                }

                var ellipse = ent as Ellipse;
                if (ellipse != null)
                {
                    return Map("kind", "ellipse", "center", Pt(ellipse.Center),
                        "major_axis", Pt(ellipse.MajorAxis), "radius_ratio", ellipse.RadiusRatio,
                        "start_angle", ellipse.StartAngle, "end_angle", ellipse.EndAngle);
                }

                var pl = ent as Polyline;
                if (pl != null)
                {
                    return PolylineGeometry(pl);
                }

                var pl2 = ent as Polyline2d;
                if (pl2 != null)
                {
                    return Polyline2dGeometry(pl2, tr);
                }

                var pl3 = ent as Polyline3d;
                if (pl3 != null)
                {
                    return Polyline3dGeometry(pl3, tr);
                }

                var spline = ent as Spline;
                if (spline != null)
                {
                    return SplineGeometry(spline);
                }

                var text = ent as DBText;
                if (text != null)
                {
                    return Map("kind", "text", "position", Pt(text.Position), "height", text.Height,
                        "rotation", text.Rotation, "alignment", Pt(text.AlignmentPoint),
                        "horizontal_mode", text.HorizontalMode.ToString());
                }

                var mtext = ent as MText;
                if (mtext != null)
                {
                    return Map("kind", "mtext", "location", Pt(mtext.Location), "height", mtext.TextHeight,
                        "width", mtext.Width, "rotation", mtext.Rotation, "attachment",
                        mtext.Attachment.ToString());
                }

                var br = ent as BlockReference;
                if (br != null)
                {
                    string blockName = br.Name;
                    try
                    {
                        var btr = (BlockTableRecord)tr.GetObject(br.BlockTableRecord, OpenMode.ForRead);
                        blockName = btr.Name;
                    }
                    catch (AcException)
                    {
                    }

                    return Map(
                        "kind", "block_reference",
                        "block_name", blockName,
                        "position", Pt(br.Position),
                        "rotation", br.Rotation,
                        "scale", new[] { br.ScaleFactors.X, br.ScaleFactors.Y, br.ScaleFactors.Z },
                        "normal", Pt(br.Normal),
                        "is_dynamic", Safe(() => br.IsDynamicBlock));
                }

                var hatch = ent as Hatch;
                if (hatch != null)
                {
                    return Map("kind", "hatch", "pattern", hatch.PatternName, "pattern_type",
                        hatch.PatternType.ToString(), "associative", hatch.Associative, "hatch_style",
                        hatch.HatchStyle.ToString());
                }

                var dim = ent as Dimension;
                if (dim != null)
                {
                    return Map("kind", "dimension", "dim_type", dim.GetType().Name,
                        "measurement", Safe(() => dim.Measurement),
                        "text_position", Safe(() => Pt(dim.TextPosition)),
                        "dim_style", Safe(() => dim.DimensionStyleName));
                }

                var leader = ent as Leader;
                if (leader != null)
                {
                    return Map("kind", "leader", "has_arrow_head", leader.HasArrowHead);
                }

                var solid = ent as Solid;
                if (solid != null)
                {
                    return Map("kind", "solid");
                }

                var region = ent as Region;
                if (region != null)
                {
                    return Map("kind", "region");
                }

                var solid3d = ent as Solid3d;
                if (solid3d != null)
                {
                    return Map("kind", "solid3d");
                }

                var table = ent as Table;
                if (table != null)
                {
                    return Map("kind", "table", "rows", Safe(() => table.Rows.Count),
                        "columns", Safe(() => table.Columns.Count));
                }

                var viewport = ent as Viewport;
                if (viewport != null)
                {
                    return Map("kind", "viewport", "number", viewport.Number, "on", viewport.On,
                        "custom_scale", viewport.CustomScale);
                }

                var attDef = ent as AttributeDefinition;
                if (attDef != null)
                {
                    return Map("kind", "attdef", "tag", attDef.Tag, "position", Pt(attDef.Position),
                        "height", attDef.Height, "invisible", attDef.Invisible);
                }

                var wipeout = ent as Wipeout;
                if (wipeout != null)
                {
                    return Map("kind", "wipeout");
                }

                var proxy = ent as ProxyEntity;
                if (proxy != null)
                {
                    return Map("kind", "proxy");
                }

                string rx = RxName(ent);
                if (rx.StartsWith("TH_", StringComparison.Ordinal) || rx.StartsWith("PC_", StringComparison.Ordinal))
                {
                    return Map("kind", "professional", "rx", rx, "custom", CustomPayload(ent));
                }

                return Map("kind", "unparsed", "managed_type", ent.GetType().Name);
            }
            catch (System.Exception ex)
            {
                return Map("kind", "error", "error", Clip(ex.Message, 512));
            }
        }

        static Dictionary<string, object> PolylineGeometry(Polyline pl)
        {
            int n = pl.NumberOfVertices;
            int emit = Math.Min(n, MaxPolylineVertices);
            var vertices = new List<object>(emit);
            for (int i = 0; i < emit; i++)
            {
                vertices.Add(Map(
                    "point", Pt(pl.GetPoint3dAt(i)),
                    "bulge", pl.GetBulgeAt(i)));
            }

            return Map("kind", "lwpolyline", "closed", pl.Closed, "elevation", pl.Elevation,
                "constant_width", pl.ConstantWidth, "vertex_count", n, "vertices_truncated", n > emit,
                "vertices", vertices);
        }

        static Dictionary<string, object> Polyline2dGeometry(Polyline2d pl, Transaction tr)
        {
            var vertices = new List<object>();
            int n = 0;
            foreach (ObjectId id in pl)
            {
                n++;
                if (vertices.Count >= MaxPolylineVertices)
                {
                    continue;
                }

                var v = tr.GetObject(id, OpenMode.ForRead) as Vertex2d;
                if (v != null)
                {
                    vertices.Add(Map("point", Pt(v.Position), "bulge", v.Bulge));
                }
            }

            return Map("kind", "polyline2d", "closed", pl.Closed, "vertex_count", n,
                "vertices_truncated", n > vertices.Count, "vertices", vertices);
        }

        static Dictionary<string, object> Polyline3dGeometry(Polyline3d pl, Transaction tr)
        {
            var vertices = new List<object>();
            int n = 0;
            foreach (ObjectId id in pl)
            {
                n++;
                if (vertices.Count >= MaxPolylineVertices)
                {
                    continue;
                }

                var v = tr.GetObject(id, OpenMode.ForRead) as PolylineVertex3d;
                if (v != null)
                {
                    vertices.Add(Pt(v.Position));
                }
            }

            return Map("kind", "polyline3d", "closed", pl.Closed, "vertex_count", n,
                "vertices_truncated", n > vertices.Count, "vertices", vertices);
        }

        static Dictionary<string, object> SplineGeometry(Spline spline)
        {
            int n = spline.NumControlPoints;
            int emit = Math.Min(n, MaxSplinePoints);
            var points = new List<object>(emit);
            for (int i = 0; i < emit; i++)
            {
                points.Add(Pt(spline.GetControlPointAt(i)));
            }

            return Map("kind", "spline", "degree", spline.Degree, "closed", spline.Closed,
                "control_point_count", n, "control_points_truncated", n > emit, "control_points", points);
        }

        static object TextOf(Entity ent)
        {
            var text = ent as DBText;
            if (text != null)
            {
                return text.TextString;
            }

            var mtext = ent as MText;
            if (mtext != null)
            {
                return Map("contents", mtext.Contents, "plain", Safe(() => mtext.Text));
            }

            var att = ent as AttributeReference;
            if (att != null)
            {
                return Map("tag", att.Tag, "value", att.TextString);
            }

            var attDef = ent as AttributeDefinition;
            if (attDef != null)
            {
                return Map("tag", attDef.Tag, "prompt", attDef.Prompt, "value", attDef.TextString);
            }

            var dim = ent as Dimension;
            if (dim != null)
            {
                return Map("dimension_text", dim.DimensionText, "measurement", Safe(() => dim.Measurement));
            }

            return null;
        }

        static DrawingZoneTextSample ZoneTextSampleOf(Entity ent)
        {
            var text = ent as DBText;
            if (text != null)
            {
                string value = text.TextString ?? "";
                Point3d anchor = text.Position;
                try
                {
                    if (!string.Equals(
                        text.HorizontalMode.ToString(),
                        "TextLeft",
                        StringComparison.Ordinal))
                    {
                        anchor = text.AlignmentPoint;
                    }
                }
                catch
                {
                    // Position remains a safe fallback for unusual text objects.
                }

                return new DrawingZoneTextSample(
                    HandleOf(text),
                    Safe(() => text.Layer) as string ?? "",
                    value,
                    anchor.X,
                    anchor.Y);
            }

            var mtext = ent as MText;
            if (mtext != null)
            {
                Point3d anchor = mtext.Location;
                try
                {
                    Extents3d ext = mtext.GeometricExtents;
                    anchor = new Point3d(
                        (ext.MinPoint.X + ext.MaxPoint.X) * 0.5,
                        (ext.MinPoint.Y + ext.MaxPoint.Y) * 0.5,
                        (ext.MinPoint.Z + ext.MaxPoint.Z) * 0.5);
                }
                catch
                {
                    // Location remains a safe fallback.
                }

                return new DrawingZoneTextSample(
                    HandleOf(mtext),
                    Safe(() => mtext.Layer) as string ?? "",
                    Safe(() => mtext.Text) as string ?? mtext.Contents ?? "",
                    anchor.X,
                    anchor.Y);
            }

            return null;
        }

        static object AttributesOf(Entity ent, Transaction tr)
        {
            var br = ent as BlockReference;
            if (br == null || br.AttributeCollection == null || br.AttributeCollection.Count == 0)
            {
                return null;
            }

            var list = new List<object>();
            foreach (ObjectId id in br.AttributeCollection)
            {
                try
                {
                    var ar = tr.GetObject(id, OpenMode.ForRead) as AttributeReference;
                    if (ar == null)
                    {
                        continue;
                    }

                    list.Add(Map(
                        "handle", HandleOf(ar),
                        "tag", ar.Tag,
                        "value", ar.TextString,
                        "invisible", ar.Invisible,
                        "position", Pt(ar.Position)));
                }
                catch (AcException)
                {
                }
            }

            return list.Count == 0 ? null : list;
        }

        static object XDataOf(DBObject obj)
        {
            ResultBuffer rb = obj.XData;
            if (rb == null)
            {
                return null;
            }

            var result = new Dictionary<string, List<object>>(StringComparer.Ordinal);
            string app = null;
            List<object> cur = null;
            foreach (TypedValue tv in rb)
            {
                if (tv.TypeCode == (short)DxfCode.ExtendedDataRegAppName)
                {
                    app = Convert.ToString(tv.Value, CultureInfo.InvariantCulture) ?? "";
                    cur = new List<object>();
                    result[app] = cur;
                }
                else if (cur != null)
                {
                    cur.Add(Map("code", (int)tv.TypeCode, "value", TvValue(tv.Value)));
                }
            }

            return result.Count == 0 ? null : result;
        }

        static object ExtDictOf(DBObject obj, Transaction tr)
        {
            if (obj.ExtensionDictionary.IsNull)
            {
                return null;
            }

            try
            {
                var dict = tr.GetObject(obj.ExtensionDictionary, OpenMode.ForRead, false) as DBDictionary;
                return dict == null ? null : DumpDictionary(dict, tr, MaxDictionaryDepth);
            }
            catch (AcException)
            {
                return Map("error", "extension_dictionary_unreadable");
            }
        }

        static object DumpDictionary(DBDictionary dict, Transaction tr, int depth)
        {
            var items = new Dictionary<string, object>(StringComparer.Ordinal);
            foreach (DBDictionaryEntry entry in dict)
            {
                try
                {
                    DBObject child = tr.GetObject(entry.Value, OpenMode.ForRead, false);
                    items[entry.Key] = DumpDbObject(child, tr, depth - 1);
                }
                catch (System.Exception ex)
                {
                    items[entry.Key] = Map("error", Clip(ex.Message, 512));
                }
            }

            return Map(
                "handle", HandleOf(dict),
                "runtime_class", RxName(dict),
                "is_proxy", dict.IsAProxy,
                "count", dict.Count,
                "items", items);
        }

        static object DumpDbObject(DBObject obj, Transaction tr, int depth)
        {
            var xr = obj as Xrecord;
            if (xr != null)
            {
                var values = new List<object>();
                if (xr.Data != null)
                {
                    foreach (TypedValue tv in xr.Data)
                    {
                        values.Add(Map("code", (int)tv.TypeCode, "value", TvValue(tv.Value)));
                    }
                }

                return Map("kind", "xrecord", "handle", HandleOf(xr), "is_proxy", xr.IsAProxy, "data", values);
            }

            var nested = obj as DBDictionary;
            if (nested != null)
            {
                if (depth <= 0)
                {
                    return Map("kind", "dictionary", "handle", HandleOf(nested), "truncated", true,
                        "count", nested.Count);
                }

                return DumpDictionary(nested, tr, depth);
            }

            return Map(
                "kind", "object",
                "handle", HandleOf(obj),
                "runtime_class", RxName(obj),
                "managed_type", obj.GetType().Name,
                "is_proxy", obj.IsAProxy);
        }

        static void DumpNamedObjects(Database db, Transaction tr, StreamWriter writer)
        {
            var nod = tr.GetObject(db.NamedObjectsDictionaryId, OpenMode.ForRead) as DBDictionary;
            if (nod == null)
            {
                return;
            }

            foreach (DBDictionaryEntry entry in nod)
            {
                try
                {
                    DBObject child = tr.GetObject(entry.Value, OpenMode.ForRead, false);
                    WriteLine(writer, Map(
                        "key", entry.Key,
                        "object", DumpDbObject(child, tr, MaxDictionaryDepth)));
                }
                catch (System.Exception ex)
                {
                    WriteLine(writer, Map("key", entry.Key, "error", Clip(ex.Message, 512)));
                }
            }
        }

        static Dictionary<string, object> DumpTables(
            Database db,
            Transaction tr,
            out List<Dictionary<string, object>> blockInventory)
        {
            var layers = new List<object>();
            var layerTable = (LayerTable)tr.GetObject(db.LayerTableId, OpenMode.ForRead);
            foreach (ObjectId id in layerTable)
            {
                var rec = (LayerTableRecord)tr.GetObject(id, OpenMode.ForRead);
                layers.Add(Map(
                    "name", rec.Name,
                    "handle", HandleOf(rec),
                    "off", rec.IsOff,
                    "frozen", rec.IsFrozen,
                    "locked", rec.IsLocked,
                    "color", rec.Color.ToString(),
                    "linetype", Safe(() =>
                    {
                        var lt = (LinetypeTableRecord)tr.GetObject(rec.LinetypeObjectId, OpenMode.ForRead);
                        return lt.Name;
                    })));
            }

            var linetypes = new List<object>();
            var linetypeTable = (LinetypeTable)tr.GetObject(db.LinetypeTableId, OpenMode.ForRead);
            foreach (ObjectId id in linetypeTable)
            {
                var rec = (LinetypeTableRecord)tr.GetObject(id, OpenMode.ForRead);
                linetypes.Add(Map("name", rec.Name, "handle", HandleOf(rec), "ascii_description", rec.AsciiDescription));
            }

            var textStyles = new List<object>();
            var textTable = (TextStyleTable)tr.GetObject(db.TextStyleTableId, OpenMode.ForRead);
            foreach (ObjectId id in textTable)
            {
                var rec = (TextStyleTableRecord)tr.GetObject(id, OpenMode.ForRead);
                textStyles.Add(Map(
                    "name", rec.Name,
                    "handle", HandleOf(rec),
                    "font_file", rec.FileName,
                    "big_font_file", rec.BigFontFileName,
                    "text_size", rec.TextSize));
            }

            var dimStyles = new List<object>();
            var dimTable = (DimStyleTable)tr.GetObject(db.DimStyleTableId, OpenMode.ForRead);
            foreach (ObjectId id in dimTable)
            {
                var rec = (DimStyleTableRecord)tr.GetObject(id, OpenMode.ForRead);
                dimStyles.Add(Map("name", rec.Name, "handle", HandleOf(rec)));
            }

            var apps = new List<object>();
            var appTable = (RegAppTable)tr.GetObject(db.RegAppTableId, OpenMode.ForRead);
            foreach (ObjectId id in appTable)
            {
                var rec = (RegAppTableRecord)tr.GetObject(id, OpenMode.ForRead);
                apps.Add(Map("name", rec.Name, "handle", HandleOf(rec)));
            }

            blockInventory = new List<Dictionary<string, object>>();
            var bt = (BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead);
            foreach (ObjectId id in bt)
            {
                var btr = (BlockTableRecord)tr.GetObject(id, OpenMode.ForRead);
                int count = 0;
                foreach (ObjectId ignored in btr)
                {
                    count++;
                }

                blockInventory.Add(Map(
                    "name", btr.Name,
                    "handle", HandleOf(btr),
                    "owner_scope", OwnerScope(btr),
                    "is_layout", btr.IsLayout,
                    "is_anonymous", btr.IsAnonymous,
                    "is_from_xref", btr.IsFromExternalReference,
                    "xref_path", btr.PathName,
                    "has_attribute_definitions", btr.HasAttributeDefinitions,
                    "entity_count", count,
                    "origin", Pt(btr.Origin)));
            }

            var layouts = new List<object>();
            var layoutDict = (DBDictionary)tr.GetObject(db.LayoutDictionaryId, OpenMode.ForRead);
            foreach (DBDictionaryEntry entry in layoutDict)
            {
                var layout = tr.GetObject(entry.Value, OpenMode.ForRead) as Layout;
                if (layout == null)
                {
                    continue;
                }

                layouts.Add(Map(
                    "name", layout.LayoutName,
                    "handle", HandleOf(layout),
                    "tab_order", layout.TabOrder,
                    "model_type", layout.ModelType,
                    "block_handle", HandleOf(layout.BlockTableRecordId)));
            }

            return Map(
                "layers", layers,
                "linetypes", linetypes,
                "text_styles", textStyles,
                "dim_styles", dimStyles,
                "reg_apps", apps,
                "layouts", layouts,
                "blocks", blockInventory);
        }

        static string OwnerScope(BlockTableRecord btr)
        {
            if (btr.IsLayout)
            {
                if (string.Equals(btr.Name, BlockTableRecord.ModelSpace, StringComparison.OrdinalIgnoreCase)
                    || string.Equals(btr.Name, "*MODEL_SPACE", StringComparison.OrdinalIgnoreCase))
                {
                    return "model_space";
                }

                return "paper_space";
            }

            if (btr.IsFromExternalReference)
            {
                return "xref";
            }

            return "block_definition";
        }

        static Dictionary<string, object> HostInfo()
        {
            string version = "unknown";
            try
            {
                version = CoreApp.Version.ToString();
            }
            catch
            {
            }

            return Map(
                "application", "THCAD",
                "application_version", version,
                "plugin", "Shb.Thcad.Extractor",
                "plugin_version", "0.2.0",
                "clr", Environment.Version.ToString(),
                "machine", Environment.MachineName);
        }

        static void CollectSemantic(
            Dictionary<string, object> record,
            Entity ent,
            List<Dictionary<string, object>> titleBlocks,
            List<Dictionary<string, object>> bomRows,
            List<Dictionary<string, object>> otherPcBlocks,
            List<Dictionary<string, object>> professionalEntities,
            List<MechanicalBomRowObservation> bomObservations = null)
        {
            Dictionary<string, object> geom = record["geometry"] as Dictionary<string, object>;
            string blockName = null;
            if (geom != null && geom.ContainsKey("block_name"))
            {
                blockName = Convert.ToString(geom["block_name"]);
            }

            if (blockName == "PC_TITLE_BLOCK")
            {
                titleBlocks.Add(SemanticBlock("title_block", record));
            }
            else if (blockName == "PC_MXB_BLOCK")
            {
                bomRows.Add(SemanticBlock("bom_row", record));
                if (bomObservations != null)
                {
                    bomObservations.Add(MechanicalBomObservationOf(record));
                }
            }
            else if (blockName != null
                && (blockName.StartsWith("PC_", StringComparison.Ordinal)
                    || blockName.StartsWith("PCCAD_", StringComparison.Ordinal)))
            {
                otherPcBlocks.Add(SemanticBlock("pc_block", record));
            }

            string rx = Convert.ToString(record["runtime_class"]) ?? "";
            if (rx.StartsWith("TH_", StringComparison.Ordinal))
            {
                object custom = CustomPayload(ent);
                record["custom"] = custom;
                professionalEntities.Add(Map(
                    "handle", record["handle"],
                    "runtime_class", rx,
                    "layer", record["layer"],
                    "bbox", record.ContainsKey("bbox") ? record["bbox"] : null,
                    "xdata", record.ContainsKey("xdata") ? record["xdata"] : null,
                    "custom", custom));
            }
        }

        static Dictionary<string, object> SemanticBlock(string kind, Dictionary<string, object> record)
        {
            var fields = new Dictionary<string, object>(StringComparer.Ordinal);
            System.Collections.IList attrs = record.ContainsKey("attributes")
                ? record["attributes"] as System.Collections.IList
                : null;
            if (attrs != null)
            {
                foreach (object item in attrs)
                {
                    Dictionary<string, object> row = item as Dictionary<string, object>;
                    if (row == null || !row.ContainsKey("tag"))
                    {
                        continue;
                    }

                    string tag = Convert.ToString(row["tag"]);
                    if (!string.IsNullOrEmpty(tag))
                    {
                        fields[tag] = row.ContainsKey("value") ? row["value"] : "";
                    }
                }
            }

            Dictionary<string, object> geom = record["geometry"] as Dictionary<string, object>;
            return Map(
                "kind", kind,
                "handle", record["handle"],
                "block_name", geom != null && geom.ContainsKey("block_name") ? geom["block_name"] : null,
                "position", geom != null && geom.ContainsKey("position") ? geom["position"] : null,
                "xdata", record.ContainsKey("xdata") ? record["xdata"] : null,
                "fields", fields);
        }

        static MechanicalBomRowObservation MechanicalBomObservationOf(
            Dictionary<string, object> record)
        {
            var cells = new List<MechanicalBomCellObservation>();
            System.Collections.IList attrs = record.ContainsKey("attributes")
                ? record["attributes"] as System.Collections.IList
                : null;
            if (attrs != null)
            {
                foreach (object item in attrs)
                {
                    Dictionary<string, object> attribute = item as Dictionary<string, object>;
                    if (attribute == null)
                    {
                        continue;
                    }
                    object position = attribute.ContainsKey("position")
                        ? attribute["position"]
                        : null;
                    cells.Add(new MechanicalBomCellObservation(
                        attribute.ContainsKey("tag") ? Convert.ToString(attribute["tag"]) : "",
                        attribute.ContainsKey("value") ? Convert.ToString(attribute["value"]) : "",
                        attribute.ContainsKey("handle") ? Convert.ToString(attribute["handle"]) : "",
                        CoordinateAt(position, 0, double.NaN),
                        CoordinateAt(position, 1, double.NaN)));
                }
            }

            Dictionary<string, object> geometry = record.ContainsKey("geometry")
                ? record["geometry"] as Dictionary<string, object>
                : null;
            object blockPosition = geometry != null && geometry.ContainsKey("position")
                ? geometry["position"]
                : null;
            Dictionary<string, object> bbox = record.ContainsKey("bbox")
                ? record["bbox"] as Dictionary<string, object>
                : null;
            object bboxMin = bbox != null && bbox.ContainsKey("min") ? bbox["min"] : null;
            object bboxMax = bbox != null && bbox.ContainsKey("max") ? bbox["max"] : null;
            double positionX = CoordinateAt(blockPosition, 0, 0);
            double positionY = CoordinateAt(blockPosition, 1, 0);

            return new MechanicalBomRowObservation(
                record.ContainsKey("handle") ? Convert.ToString(record["handle"]) : "",
                positionX,
                positionY,
                CoordinateAt(bboxMin, 0, positionX),
                CoordinateAt(bboxMin, 1, positionY),
                CoordinateAt(bboxMax, 0, positionX),
                CoordinateAt(bboxMax, 1, positionY),
                ThXuhaoItemNumber(record),
                cells);
        }

        static TechnicalRequirementTextObservation TechnicalRequirementTextObservationOf(
            Dictionary<string, object> record)
        {
            string managedType = record.ContainsKey("managed_type")
                ? Convert.ToString(record["managed_type"], CultureInfo.InvariantCulture)
                : "";
            if (!string.Equals(managedType, "DBText", StringComparison.Ordinal)
                && !string.Equals(managedType, "MText", StringComparison.Ordinal))
            {
                return null;
            }

            string value = "";
            object text = record.ContainsKey("text") ? record["text"] : null;
            if (text is string)
            {
                value = (string)text;
            }
            else
            {
                Dictionary<string, object> textMap = text as Dictionary<string, object>;
                if (textMap != null && textMap.ContainsKey("plain"))
                {
                    value = Convert.ToString(textMap["plain"], CultureInfo.InvariantCulture) ?? "";
                }
            }

            Dictionary<string, object> bbox = record.ContainsKey("bbox")
                ? record["bbox"] as Dictionary<string, object>
                : null;
            if (bbox == null || !bbox.ContainsKey("min") || !bbox.ContainsKey("max"))
            {
                return null;
            }
            double minX = CoordinateAt(bbox["min"], 0, double.NaN);
            double minY = CoordinateAt(bbox["min"], 1, double.NaN);
            double maxX = CoordinateAt(bbox["max"], 0, double.NaN);
            double maxY = CoordinateAt(bbox["max"], 1, double.NaN);
            if (double.IsNaN(minX)
                || double.IsNaN(minY)
                || double.IsNaN(maxX)
                || double.IsNaN(maxY))
            {
                return null;
            }

            return new TechnicalRequirementTextObservation(
                record.ContainsKey("handle")
                    ? Convert.ToString(record["handle"], CultureInfo.InvariantCulture)
                    : "",
                record.ContainsKey("layer")
                    ? Convert.ToString(record["layer"], CultureInfo.InvariantCulture)
                    : "",
                value,
                minX,
                minY,
                maxX,
                maxY);
        }

        static BodyCenterlineTextObservation BodyCenterlineTextObservationOf(
            Dictionary<string, object> record)
        {
            string managedType = record.ContainsKey("managed_type")
                ? Convert.ToString(record["managed_type"], CultureInfo.InvariantCulture)
                : "";
            if (!string.Equals(managedType, "DBText", StringComparison.Ordinal)
                && !string.Equals(managedType, "MText", StringComparison.Ordinal))
            {
                return null;
            }

            string value = "";
            object text = record.ContainsKey("text") ? record["text"] : null;
            if (text is string)
            {
                value = (string)text;
            }
            else
            {
                Dictionary<string, object> textMap = text as Dictionary<string, object>;
                if (textMap != null && textMap.ContainsKey("plain"))
                {
                    value = Convert.ToString(textMap["plain"], CultureInfo.InvariantCulture) ?? "";
                }
            }

            Dictionary<string, object> bbox = record.ContainsKey("bbox")
                ? record["bbox"] as Dictionary<string, object>
                : null;
            if (bbox == null || !bbox.ContainsKey("min") || !bbox.ContainsKey("max"))
            {
                return null;
            }
            double minX = CoordinateAt(bbox["min"], 0, double.NaN);
            double minY = CoordinateAt(bbox["min"], 1, double.NaN);
            double maxX = CoordinateAt(bbox["max"], 0, double.NaN);
            double maxY = CoordinateAt(bbox["max"], 1, double.NaN);
            if (double.IsNaN(minX)
                || double.IsNaN(minY)
                || double.IsNaN(maxX)
                || double.IsNaN(maxY))
            {
                return null;
            }

            return new BodyCenterlineTextObservation(
                record.ContainsKey("handle")
                    ? Convert.ToString(record["handle"], CultureInfo.InvariantCulture)
                    : "",
                record.ContainsKey("layer")
                    ? Convert.ToString(record["layer"], CultureInfo.InvariantCulture)
                    : "",
                record.ContainsKey("owner_scope")
                    ? Convert.ToString(record["owner_scope"], CultureInfo.InvariantCulture)
                    : "",
                value,
                minX,
                minY,
                maxX,
                maxY);
        }

        static CadLayerEntityObservation CadLayerEntityObservationOf(
            Dictionary<string, object> record)
        {
            Dictionary<string, object> geometry = record.ContainsKey("geometry")
                ? record["geometry"] as Dictionary<string, object>
                : null;
            string referencedBlockName = geometry != null && geometry.ContainsKey("block_name")
                ? Convert.ToString(geometry["block_name"], CultureInfo.InvariantCulture) ?? ""
                : "";
            bool visible = true;
            if (record.ContainsKey("visible") && record["visible"] != null)
            {
                try
                {
                    visible = Convert.ToBoolean(record["visible"], CultureInfo.InvariantCulture);
                }
                catch
                {
                    visible = true;
                }
            }
            return new CadLayerEntityObservation(
                record.ContainsKey("handle")
                    ? Convert.ToString(record["handle"], CultureInfo.InvariantCulture)
                    : "",
                record.ContainsKey("layer")
                    ? Convert.ToString(record["layer"], CultureInfo.InvariantCulture)
                    : "",
                record.ContainsKey("owner_scope")
                    ? Convert.ToString(record["owner_scope"], CultureInfo.InvariantCulture)
                    : "",
                record.ContainsKey("owner_block_name")
                    ? Convert.ToString(record["owner_block_name"], CultureInfo.InvariantCulture)
                    : "",
                record.ContainsKey("managed_type")
                    ? Convert.ToString(record["managed_type"], CultureInfo.InvariantCulture)
                    : "",
                visible,
                record.ContainsKey("decode_status")
                    && string.Equals(
                        Convert.ToString(record["decode_status"], CultureInfo.InvariantCulture),
                        "proxy",
                        StringComparison.Ordinal),
                referencedBlockName);
        }

        static List<CadLayerDefinitionObservation> LayerDefinitionsOf(
            Dictionary<string, object> tables)
        {
            var result = new List<CadLayerDefinitionObservation>();
            System.Collections.IList layers = tables != null && tables.ContainsKey("layers")
                ? tables["layers"] as System.Collections.IList
                : null;
            if (layers == null)
            {
                return result;
            }
            foreach (object item in layers)
            {
                Dictionary<string, object> layer = item as Dictionary<string, object>;
                if (layer == null)
                {
                    continue;
                }
                result.Add(new CadLayerDefinitionObservation(
                    layer.ContainsKey("name")
                        ? Convert.ToString(layer["name"], CultureInfo.InvariantCulture)
                        : "",
                    layer.ContainsKey("handle")
                        ? Convert.ToString(layer["handle"], CultureInfo.InvariantCulture)
                        : "",
                    BooleanValue(layer, "off"),
                    BooleanValue(layer, "frozen"),
                    BooleanValue(layer, "locked"),
                    layer.ContainsKey("color")
                        ? Convert.ToString(layer["color"], CultureInfo.InvariantCulture)
                        : "",
                    layer.ContainsKey("linetype")
                        ? Convert.ToString(layer["linetype"], CultureInfo.InvariantCulture)
                        : ""));
            }
            return result;
        }

        static List<BodyCenterlineLayerObservation> BodyCenterlineLayerDefinitionsOf(
            Dictionary<string, object> tables)
        {
            var result = new List<BodyCenterlineLayerObservation>();
            System.Collections.IList layers = tables != null && tables.ContainsKey("layers")
                ? tables["layers"] as System.Collections.IList
                : null;
            if (layers == null)
            {
                return result;
            }
            foreach (object item in layers)
            {
                Dictionary<string, object> layer = item as Dictionary<string, object>;
                if (layer == null)
                {
                    continue;
                }
                result.Add(new BodyCenterlineLayerObservation(
                    layer.ContainsKey("name")
                        ? Convert.ToString(layer["name"], CultureInfo.InvariantCulture)
                        : "",
                    layer.ContainsKey("handle")
                        ? Convert.ToString(layer["handle"], CultureInfo.InvariantCulture)
                        : "",
                    layer.ContainsKey("linetype")
                        ? Convert.ToString(layer["linetype"], CultureInfo.InvariantCulture)
                        : ""));
            }
            return result;
        }

        static bool BooleanValue(Dictionary<string, object> values, string key)
        {
            if (values == null || !values.ContainsKey(key) || values[key] == null)
            {
                return false;
            }
            try
            {
                return Convert.ToBoolean(values[key], CultureInfo.InvariantCulture);
            }
            catch
            {
                return false;
            }
        }

        static string ThXuhaoItemNumber(Dictionary<string, object> record)
        {
            Dictionary<string, object> xdata = record.ContainsKey("xdata")
                ? record["xdata"] as Dictionary<string, object>
                : null;
            if (xdata == null || !xdata.ContainsKey("TH_XUHAO"))
            {
                return "";
            }

            System.Collections.IList values = xdata["TH_XUHAO"] as System.Collections.IList;
            if (values == null)
            {
                return "";
            }
            foreach (object item in values)
            {
                Dictionary<string, object> typed = item as Dictionary<string, object>;
                if (typed == null || !typed.ContainsKey("code"))
                {
                    continue;
                }
                int code;
                try
                {
                    code = Convert.ToInt32(typed["code"], CultureInfo.InvariantCulture);
                }
                catch
                {
                    continue;
                }
                if (code == 1000 && typed.ContainsKey("value"))
                {
                    return Convert.ToString(typed["value"], CultureInfo.InvariantCulture) ?? "";
                }
            }
            return "";
        }

        static double CoordinateAt(object value, int index, double fallback)
        {
            System.Collections.IList values = value as System.Collections.IList;
            if (values == null || index < 0 || index >= values.Count)
            {
                return fallback;
            }
            try
            {
                return Convert.ToDouble(values[index], CultureInfo.InvariantCulture);
            }
            catch
            {
                return fallback;
            }
        }

        static Dictionary<string, object> CustomPayload(Entity ent)
        {
            var payload = new Dictionary<string, object>(StringComparer.Ordinal);
            payload["managed_type"] = ent.GetType().FullName;
            payload["rx"] = RxName(ent);

            try
            {
                var exploded = new DBObjectCollection();
                ent.Explode(exploded);
                var parts = new List<object>();
                foreach (DBObject obj in exploded)
                {
                    try
                    {
                        var text = obj as DBText;
                        if (text != null)
                        {
                            parts.Add(Map("kind", "text", "string", text.TextString, "position", Pt(text.Position),
                                "height", text.Height));
                            continue;
                        }

                        var mtext = obj as MText;
                        if (mtext != null)
                        {
                            parts.Add(Map("kind", "mtext", "contents", mtext.Contents, "plain", Safe(() => mtext.Text)));
                            continue;
                        }

                        var child = obj as Entity;
                        if (child != null)
                        {
                            parts.Add(Map(
                                "kind", child.GetType().Name,
                                "rx", RxName(child),
                                "layer", Safe(() => child.Layer),
                                "bbox", BBoxOf(child)));
                        }
                    }
                    finally
                    {
                        obj.Dispose();
                    }
                }

                payload["explode"] = parts;
                payload["explode_count"] = parts.Count;
            }
            catch (System.Exception ex)
            {
                payload["explode_error"] = Clip(ex.Message, 512);
            }

            var props = new Dictionary<string, object>(StringComparer.Ordinal);
            try
            {
                foreach (PropertyInfo info in ent.GetType().GetProperties(BindingFlags.Public | BindingFlags.Instance))
                {
                    if (!info.CanRead || info.GetIndexParameters().Length > 0)
                    {
                        continue;
                    }

                    string name = info.Name;
                    if (name == "Database" || name == "Document" || name == "UndoFiler" || name == "Drawable")
                    {
                        continue;
                    }

                    try
                    {
                        object value = info.GetValue(ent, null);
                        if (value == null || value is Database || value is Transaction)
                        {
                            continue;
                        }

                        if (value is string || value is bool || value is byte || value is short || value is int
                            || value is long || value is float || value is double || value is decimal)
                        {
                            props[name] = value;
                        }
                        else if (value is Point3d)
                        {
                            props[name] = Pt((Point3d)value);
                        }
                        else if (value is Vector3d)
                        {
                            props[name] = Pt((Vector3d)value);
                        }
                        else
                        {
                            string rendered = Convert.ToString(value, CultureInfo.InvariantCulture);
                            if (!string.IsNullOrEmpty(rendered) && rendered.Length <= 256
                                && rendered != value.GetType().FullName)
                            {
                                props[name] = rendered;
                            }
                        }
                    }
                    catch
                    {
                    }
                }
            }
            catch
            {
            }

            if (props.Count > 0)
            {
                payload["properties"] = props;
            }

            return payload;
        }

        static object BBoxOf(Entity ent)
        {
            try
            {
                Extents3d ext = ent.GeometricExtents;
                return Map("min", Pt(ext.MinPoint), "max", Pt(ext.MaxPoint));
            }
            catch
            {
                return null;
            }
        }

        static object ColorOf(Entity ent)
        {
            try
            {
                var c = ent.Color;
                return Map(
                    "index", c.ColorIndex,
                    "is_by_layer", c.IsByLayer,
                    "is_by_block", c.IsByBlock,
                    "name", c.ToString());
            }
            catch
            {
                return null;
            }
        }

        static double[] Pt(Point3d p)
        {
            return new[] { p.X, p.Y, p.Z };
        }

        static double[] Pt(Vector3d v)
        {
            return new[] { v.X, v.Y, v.Z };
        }

        static object TvValue(object value)
        {
            if (value == null)
            {
                return null;
            }

            if (value is Point3d)
            {
                return Pt((Point3d)value);
            }

            if (value is Point2d)
            {
                var p = (Point2d)value;
                return new[] { p.X, p.Y };
            }

            if (value is ObjectId)
            {
                return HandleOf((ObjectId)value);
            }

            if (value is byte[])
            {
                return (byte[])value;
            }

            return value;
        }

        static string RxName(DBObject obj)
        {
            try
            {
                return obj.GetRXClass().Name;
            }
            catch
            {
                return obj.GetType().Name;
            }
        }

        static string HandleOf(DBObject obj)
        {
            try
            {
                return obj.Handle.ToString();
            }
            catch
            {
                return "";
            }
        }

        static string HandleOf(ObjectId id)
        {
            try
            {
                return id.Handle.ToString();
            }
            catch
            {
                return "";
            }
        }

        static object Safe(Func<object> getter)
        {
            try
            {
                return getter();
            }
            catch
            {
                return null;
            }
        }

        static void Bump(Dictionary<string, int> counts, string key)
        {
            if (key == null)
            {
                key = "unknown";
            }

            int n;
            counts.TryGetValue(key, out n);
            counts[key] = n + 1;
        }

        static Dictionary<string, object> Map(params object[] pairs)
        {
            if (pairs.Length % 2 != 0)
            {
                throw new ArgumentException("pairs");
            }

            var map = new Dictionary<string, object>(pairs.Length / 2, StringComparer.Ordinal);
            for (int i = 0; i < pairs.Length; i += 2)
            {
                map[(string)pairs[i]] = pairs[i + 1];
            }

            return map;
        }

        static string Clip(string text, int max)
        {
            if (text == null)
            {
                return "";
            }

            return text.Length <= max ? text : text.Substring(0, max);
        }

        static string SafeStem(string path)
        {
            string name = Path.GetFileNameWithoutExtension(path);
            foreach (char c in Path.GetInvalidFileNameChars())
            {
                name = name.Replace(c, '_');
            }

            return string.IsNullOrWhiteSpace(name) ? "unnamed" : name;
        }

        static string TryHash(string path)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
                {
                    return null;
                }

                using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
                using (var sha = SHA256.Create())
                {
                    byte[] hash = sha.ComputeHash(stream);
                    var sb = new StringBuilder(hash.Length * 2);
                    foreach (byte b in hash)
                    {
                        sb.Append(b.ToString("x2", CultureInfo.InvariantCulture));
                    }

                    return sb.ToString();
                }
            }
            catch
            {
                return null;
            }
        }

        static object TrySize(string path)
        {
            try
            {
                if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
                {
                    return null;
                }

                return new FileInfo(path).Length;
            }
            catch
            {
                return null;
            }
        }

        static StreamWriter NewWriter(string path)
        {
            return new StreamWriter(path, false, new UTF8Encoding(false));
        }

        static void WriteLine(StreamWriter writer, object value)
        {
            writer.WriteLine(JsonUtil.Serialize(value));
        }

        static void AtomicWrite(string path, string content)
        {
            string tmp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllText(tmp, content + "\n", new UTF8Encoding(false));
            if (File.Exists(path))
            {
                File.Delete(path);
            }

            File.Move(tmp, path);
        }
    }
}
