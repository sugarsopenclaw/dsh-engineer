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
            var bomAnnotationObservations =
                new List<MechanicalBomAnnotationObservation>();
            var xuhaoEntityHandles =
                new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var xuhaoCoordinatesByHandle =
                new Dictionary<string, XuhaoAnnotationCoordinates>(
                    StringComparer.OrdinalIgnoreCase);
            var technicalRequirementTexts = new List<TechnicalRequirementTextObservation>();
            var layerEntityObservations = new List<CadLayerEntityObservation>();
            var centerlinePrimitives = new List<CenterlinePrimitiveObservation>();
            var centerlineLabelLeaders =
                new List<CenterlineLabelLeaderObservation>();
            var annotationEntityObservations =
                new List<AnnotationEntityObservation>();
            var dimensionTopologyObservations =
                new List<DimensionTopologyObservation>();
            var engineeringLineObservations =
                new List<EngineeringLineObservation>();
            var instanceDrawingObservation = new InstanceDrawingObservation(drawingId);
            var knownTitleBlockRegions =
                new List<KnownDocumentRegionObservation>();

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
                foreach (InstanceLayerObservation instanceLayer
                    in InstanceLayerObservationsOf(tables))
                {
                    instanceDrawingObservation.AddLayer(instanceLayer);
                }

                BlockTable bt = (BlockTable)tr.GetObject(db.BlockTableId, OpenMode.ForRead);
                var instanceDefinitionsByHandle =
                    new Dictionary<string, InstanceDefinitionObservation>(
                        StringComparer.OrdinalIgnoreCase);
                foreach (ObjectId definitionId in bt)
                {
                    BlockTableRecord definition = (BlockTableRecord)tr.GetObject(
                        definitionId,
                        OpenMode.ForRead);
                    string definitionScope = OwnerScope(definition);
                    var instanceDefinition = new InstanceDefinitionObservation(
                        HandleOf(definition),
                        definition.Name,
                        definitionScope,
                        definition.IsLayout,
                        definition.IsFromExternalReference,
                        definition.IsAnonymous);
                    instanceDefinitionsByHandle[instanceDefinition.Handle] = instanceDefinition;
                    instanceDrawingObservation.AddDefinition(instanceDefinition);
                }
                foreach (ObjectId btrId in bt)
                {
                    BlockTableRecord btr = (BlockTableRecord)tr.GetObject(btrId, OpenMode.ForRead);
                    string ownerScope = OwnerScope(btr);
                    InstanceDefinitionObservation instanceDefinition;
                    instanceDefinitionsByHandle.TryGetValue(
                        HandleOf(btr),
                        out instanceDefinition);
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

                            XuhaoAnnotationCoordinates xuhaoCoordinates =
                                XuhaoAnnotationCoordinateExtractor.Extract(ent);
                            Dictionary<string, object> record = SerializeEntity(
                                ent,
                                btr,
                                ownerScope,
                                tr,
                                xuhaoCoordinates);
                            if (instanceDefinition != null)
                            {
                                instanceDefinition.AddEntity(
                                    InstanceEntityObservationOf(record, ent, tr));
                            }
                            engineeringLineObservations.Add(
                                EngineeringLineObservationOf(record));
                            CenterlinePrimitiveObservation centerlinePrimitive =
                                CenterlinePrimitiveObservationOf(record);
                            if (centerlinePrimitive != null)
                            {
                                centerlinePrimitives.Add(centerlinePrimitive);
                            }
                            layerEntityObservations.Add(CadLayerEntityObservationOf(record));
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
                            if (string.Equals(
                                runtime,
                                "TH_XuHaoEntity",
                                StringComparison.Ordinal))
                            {
                                xuhaoEntityHandles.Add(
                                    Convert.ToString(record["handle"], CultureInfo.InvariantCulture)
                                    ?? "");
                                if (xuhaoCoordinates != null)
                                {
                                    xuhaoCoordinatesByHandle[
                                        Convert.ToString(
                                            record["handle"],
                                            CultureInfo.InvariantCulture) ?? ""] = xuhaoCoordinates;
                                }
                            }
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
                            KnownDocumentRegionObservation titleBlockRegion =
                                TitleBlockRegionObservationOf(record);
                            if (titleBlockRegion != null)
                            {
                                knownTitleBlockRegions.Add(titleBlockRegion);
                            }
                            CenterlineLabelLeaderObservation centerlineLabelLeader =
                                CenterlineLabelLeaderObservationOf(record);
                            if (centerlineLabelLeader != null)
                            {
                                centerlineLabelLeaders.Add(centerlineLabelLeader);
                            }
                            annotationEntityObservations.Add(
                                AnnotationEntityObservationOf(record));
                            DimensionTopologyObservation dimensionTopologyObservation =
                                DimensionTopologyObservationOf(record);
                            if (dimensionTopologyObservation != null)
                            {
                                dimensionTopologyObservations.Add(
                                    dimensionTopologyObservation);
                            }
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

                DumpNamedObjects(
                    db,
                    tr,
                    dictionaries,
                    bomAnnotationObservations,
                    xuhaoEntityHandles,
                    xuhaoCoordinatesByHandle);
                tr.Commit();
            }

            DrawingFrameDetectionResult frameDetection = DrawingFrameDetector.Detect(frameLineSegments);
            Dictionary<string, object> frameDetectionMap = frameDetection.ToMap();
            var zoneDetectionResults = new List<DrawingZoneDetectionResult>();
            var zoneDetectionSystems = new List<Dictionary<string, object>>();
            var technicalRequirementFrames = new List<TechnicalRequirementsFrameBounds>();
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
                bomObservations,
                bomAnnotationObservations);
            Dictionary<string, object> bomKnowledgeMap = bomKnowledge.ToMap();
            var bomZoneLocations = new List<Dictionary<string, object>>();
            int bomAnnotatedRowCount = 0;
            int bomAnnotationLinkCount = 0;
            int bomPresentAnnotationLinkCount = 0;
            foreach (MechanicalBomTableKnowledge table in bomKnowledge.Tables)
            {
                bomAnnotatedRowCount += table.AnnotatedRowCount;
                bomAnnotationLinkCount += table.AnnotationLinkCount;
                bomPresentAnnotationLinkCount += table.PresentAnnotationLinkCount;
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
            List<CenterlineLayerObservation> centerlineLayers =
                CenterlineLayerDefinitionsOf(tables);
            CenterlineIdentificationDocument centerlineIdentification =
                CenterlineIdentifier.Identify(
                    drawingId,
                    centerlineLayers,
                    centerlinePrimitives,
                    centerlineLabelLeaders);
            Dictionary<string, object> centerlineIdentificationMap =
                centerlineIdentification.ToMap();
            AnnotationIdentificationDocument annotationIdentification =
                AnnotationIdentifier.Identify(
                    drawingId,
                    annotationEntityObservations);
            Dictionary<string, object> annotationIdentificationMap =
                annotationIdentification.ToMap();
            List<DimensionReferenceAxisObservation> dimensionReferenceAxes =
                DimensionReferenceAxesOf(centerlineIdentification);
            DimensionTopologyDocument dimensionTopology =
                DimensionTopologyAnalyzer.Analyze(
                    drawingId,
                    dimensionTopologyObservations,
                    dimensionReferenceAxes);
            Dictionary<string, object> dimensionTopologyMap =
                dimensionTopology.ToMap();
            List<EngineeringLayerStyleObservation> engineeringLayerStyles =
                EngineeringLayerStylesOf(tables);
            List<EngineeringLinetypeDefinitionObservation> engineeringLinetypes =
                EngineeringLinetypeDefinitionsOf(tables);
            List<string> centerGeometryHandles =
                CenterGeometryHandlesOf(centerlineIdentification);
            List<EngineeringReferenceAxisObservation> engineeringReferenceAxes =
                EngineeringReferenceAxesOf(
                    centerlineIdentification,
                    dimensionTopology);
            var engineeringLineWatch = System.Diagnostics.Stopwatch.StartNew();
            EngineeringLineSemanticDocument engineeringLineSemantics =
                EngineeringLineSemanticAnalyzer.Analyze(
                    drawingId,
                    engineeringLineObservations,
                    engineeringLayerStyles,
                    engineeringLinetypes,
                    annotationIdentification.RemovalCandidateHandles,
                    centerGeometryHandles,
                    engineeringReferenceAxes);
            engineeringLineWatch.Stop();
            Dictionary<string, object> engineeringLineSemanticsMap =
                engineeringLineSemantics.ToMap();
            var engineeringRolesByHandle = new Dictionary<string, string>(
                StringComparer.OrdinalIgnoreCase);
            foreach (EngineeringStrokeRecord stroke in engineeringLineSemantics.Strokes)
            {
                if (stroke != null && !string.IsNullOrEmpty(stroke.Handle))
                {
                    engineeringRolesByHandle[stroke.Handle] = stroke.PrimaryRole;
                }
            }
            var blockInstanceWatch = System.Diagnostics.Stopwatch.StartNew();
            BlockInstanceCoordinateDocument blockInstanceCoordinates =
                BlockInstanceCoordinateAnalyzer.Analyze(
                    instanceDrawingObservation,
                    engineeringRolesByHandle);
            blockInstanceWatch.Stop();
            Dictionary<string, object> blockInstanceCoordinatesMap =
                blockInstanceCoordinates.ToMap();
            var planarTopologyWatch = System.Diagnostics.Stopwatch.StartNew();
            PlanarTopologyDocument planarTopology = PlanarTopologyAnalyzer.Analyze(
                blockInstanceCoordinates);
            planarTopologyWatch.Stop();
            Dictionary<string, object> planarTopologyMap = planarTopology.ToMap();
            DrawingFrameCandidate primaryViewFrame = null;
            foreach (DrawingFrameCandidate candidate in frameDetection.OutermostFrames)
            {
                if (primaryViewFrame == null || candidate.Area > primaryViewFrame.Area)
                {
                    primaryViewFrame = candidate;
                }
            }
            ViewRegionFrameObservation viewRegionFrame = primaryViewFrame == null
                ? null
                : new ViewRegionFrameObservation(
                    primaryViewFrame.Id,
                    primaryViewFrame.MinX,
                    primaryViewFrame.MinY,
                    primaryViewFrame.MaxX,
                    primaryViewFrame.MaxY,
                    new[]
                    {
                        primaryViewFrame.Left.Handle,
                        primaryViewFrame.Right.Handle,
                        primaryViewFrame.Bottom.Handle,
                        primaryViewFrame.Top.Handle
                    });
            var viewRegionTexts = new List<ViewRegionTextObservation>();
            foreach (TechnicalRequirementTextObservation text in technicalRequirementTexts)
            {
                viewRegionTexts.Add(new ViewRegionTextObservation(
                    text.Handle,
                    text.Text,
                    text.MinX,
                    text.MinY,
                    text.MaxX,
                    text.MaxY,
                    "dbtext_or_mtext"));
            }
            var knownDocumentRegions = new List<KnownDocumentRegionObservation>(
                knownTitleBlockRegions);
            foreach (TechnicalRequirementsSection section in technicalRequirements.Sections)
            {
                knownDocumentRegions.Add(new KnownDocumentRegionObservation(
                    section.Id,
                    "technical_requirements",
                    section.MinX,
                    section.MinY,
                    section.MaxX,
                    section.MaxY));
            }
            foreach (MechanicalBomTableKnowledge table in bomKnowledge.Tables)
            {
                knownDocumentRegions.Add(new KnownDocumentRegionObservation(
                    table.Id,
                    "mechanical_bill_of_materials",
                    table.MinX,
                    table.MinY,
                    table.MaxX,
                    table.MaxY));
            }
            var engineeringViewRegionWatch = System.Diagnostics.Stopwatch.StartNew();
            EngineeringViewRegionDocument engineeringViewRegions =
                EngineeringViewRegionAnalyzer.Analyze(
                    blockInstanceCoordinates,
                    planarTopology,
                    viewRegionFrame,
                    viewRegionTexts,
                    knownDocumentRegions);
            engineeringViewRegionWatch.Stop();
            Dictionary<string, object> engineeringViewRegionsMap =
                engineeringViewRegions.ToMap();
            var representationCorrespondenceWatch =
                System.Diagnostics.Stopwatch.StartNew();
            RepresentationCorrespondenceDocument representationCorrespondence =
                RepresentationCorrespondenceAnalyzer.Analyze(
                    engineeringViewRegions,
                    planarTopology);
            representationCorrespondenceWatch.Stop();
            Dictionary<string, object> representationCorrespondenceMap =
                representationCorrespondence.ToMap();
            var representationIdentityWatch =
                System.Diagnostics.Stopwatch.StartNew();
            RepresentationIdentityResolutionDocument representationIdentity =
                RepresentationIdentityResolver.Analyze(
                    engineeringViewRegions,
                    representationCorrespondence);
            representationIdentityWatch.Stop();
            Dictionary<string, object> representationIdentityMap =
                representationIdentity.ToMap();
            var manufacturingProfileWatch =
                System.Diagnostics.Stopwatch.StartNew();
            ManufacturingProfileFeatureDocument manufacturingProfiles =
                ManufacturingProfileAnalyzer.Analyze(
                    engineeringViewRegions,
                    planarTopology,
                    representationIdentity);
            manufacturingProfileWatch.Stop();
            Dictionary<string, object> manufacturingProfilesMap =
                manufacturingProfiles.ToMap();
            var mechanicalInterfaceWatch =
                System.Diagnostics.Stopwatch.StartNew();
            MechanicalInterfaceAdjacencyDocument mechanicalInterfaces =
                MechanicalInterfaceAdjacencyAnalyzer.Analyze(
                    engineeringViewRegions,
                    planarTopology,
                    representationIdentity,
                    manufacturingProfiles);
            mechanicalInterfaceWatch.Stop();
            Dictionary<string, object> mechanicalInterfacesMap =
                mechanicalInterfaces.ToMap();
            var dimensionGeometryBindingWatch =
                System.Diagnostics.Stopwatch.StartNew();
            DimensionGeometryBindingDocument dimensionGeometryBindings =
                DimensionGeometryBindingAnalyzer.Analyze(
                    dimensionTopology,
                    blockInstanceCoordinates,
                    engineeringViewRegions,
                    planarTopology,
                    manufacturingProfiles,
                    mechanicalInterfaces);
            dimensionGeometryBindingWatch.Stop();
            Dictionary<string, object> dimensionGeometryBindingsMap =
                dimensionGeometryBindings.ToMap();
            var semanticDrawingSnapshotWatch =
                System.Diagnostics.Stopwatch.StartNew();
            SemanticDrawingSnapshotDocument semanticDrawingSnapshot =
                SemanticDrawingSnapshotBuilder.Create(
                    drawingId,
                    sourcePath,
                    titleBlocks,
                    bomKnowledge,
                    technicalRequirements,
                    annotationIdentification,
                    blockInstanceCoordinates,
                    engineeringViewRegions,
                    manufacturingProfiles,
                    mechanicalInterfaces,
                    dimensionGeometryBindings,
                    null);
            semanticDrawingSnapshotWatch.Stop();
            Dictionary<string, object> semanticDrawingSnapshotMap =
                semanticDrawingSnapshot.ToMap();
            var crossDrawingObservationWatch =
                System.Diagnostics.Stopwatch.StartNew();
            CrossDrawingDrawingObservation crossDrawingObservation =
                CrossDrawingProjectInputBuilder.FromSemanticSnapshot(
                    semanticDrawingSnapshot);
            AddExternalDrawingReferences(
                crossDrawingObservation,
                blockInventory);
            crossDrawingObservation.SetUnitContext(
                db.Insunits.ToString(),
                db.Measurement.ToString(),
                false,
                "dwg_unit_metadata_preserved_but_cross_file_geometry_scale_not_proven");
            crossDrawingObservationWatch.Stop();
            Dictionary<string, object> crossDrawingObservationMap =
                crossDrawingObservation.ToMap();
            int closedEngineeringContourCount = 0;
            foreach (EngineeringTopologyComponentRecord component
                in engineeringLineSemantics.Components)
            {
                if (component.IsClosed)
                {
                    closedEngineeringContourCount++;
                }
            }
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
                "mechanical_bom_annotation_source_count", bomAnnotationObservations.Count,
                "mechanical_bom_annotated_row_count", bomAnnotatedRowCount,
                "mechanical_bom_annotation_link_count", bomAnnotationLinkCount,
                "mechanical_bom_present_annotation_link_count",
                    bomPresentAnnotationLinkCount,
                "technical_requirements_section_count", technicalRequirements.Sections.Count,
                "technical_requirements_item_count", technicalRequirements.ItemCount,
                "layer_definition_count", layerAnalysis.DefinedLayerCount,
                "used_layer_definition_count", layerAnalysis.UsedDefinedLayerCount,
                "unused_layer_definition_count", layerAnalysis.UnusedDefinedLayerNames.Count,
                "off_layer_count", offLayerCount,
                "frozen_layer_count", frozenLayerCount,
                "locked_layer_count", lockedLayerCount,
                "layer_suppressed_model_entity_count", layerAnalysis.LayerSuppressedModelEntityCount,
                "center_geometry_count", centerlineIdentification.Centerlines.Count,
                "center_geometry_text_matched_count", centerlineIdentification.TextMatchedCount,
                "center_geometry_style_matched_count", centerlineIdentification.StyleMatchedCount,
                "center_geometry_both_matched_count", centerlineIdentification.BothMatchedCount,
                "center_geometry_model_space_count", centerlineIdentification.ModelSpaceCount,
                "center_geometry_block_definition_count",
                    centerlineIdentification.BlockDefinitionCount,
                "center_shape_count", centerlineIdentification.Shapes.Count,
                "center_intersection_count", centerlineIdentification.Intersections.Count,
                "center_horizontal_line_count",
                    centerlineIdentification.HorizontalLineCount,
                "center_vertical_line_count",
                    centerlineIdentification.VerticalLineCount,
                "center_angled_line_count",
                    centerlineIdentification.AngledLineCount,
                "annotation_count", annotationIdentification.Count,
                "annotation_type_counts", annotationIdentification.TypeCounts,
                "annotation_removal_candidate_handle_count",
                    annotationIdentification.RemovalCandidateHandles.Count,
                "dimension_linear_count", dimensionTopology.Edges.Count,
                "dimension_topology_group_count", dimensionTopology.Groups.Count,
                "dimension_continuous_chain_count", dimensionTopology.Chains.Count,
                "dimension_equation_count", dimensionTopology.Equations.Count,
                "dimension_derived_count", dimensionTopology.DerivedDimensions.Count,
                "dimension_datum_profile_count", dimensionTopology.DatumProfiles.Count,
                "dimension_unsupported_count", dimensionTopology.UnsupportedDimensionCount,
                "engineering_layer_style_catalog_count",
                    engineeringLineSemantics.LayerStyles.Count,
                "engineering_style_profile_count",
                    engineeringLineSemantics.StyleProfiles.Count,
                "engineering_unresolved_style_profile_count",
                    engineeringLineSemantics.UnresolvedStyleProfiles.Count,
                "engineering_color_usage_count", engineeringLineSemantics.Colors.Count,
                "engineering_linetype_catalog_count", engineeringLineSemantics.Linetypes.Count,
                "engineering_stroke_count", engineeringLineSemantics.Strokes.Count,
                "engineering_topology_component_count",
                    engineeringLineSemantics.Components.Count,
                "engineering_closed_contour_count", closedEngineeringContourCount,
                "engineering_relation_count", engineeringLineSemantics.Relations.Count,
                "engineering_repeated_pattern_count",
                    engineeringLineSemantics.RepeatedPatterns.Count,
                "engineering_symmetry_evaluation_count",
                    engineeringLineSemantics.SymmetryEvaluations.Count,
                "engineering_line_semantics_elapsed_ms",
                    Math.Round(engineeringLineWatch.Elapsed.TotalMilliseconds, 1),
                "block_instance_occurrence_count",
                    blockInstanceCoordinates.Occurrences.Count,
                "block_instance_curve_occurrence_count",
                    blockInstanceCoordinates.CurveOccurrenceCount,
                "block_instance_mirrored_occurrence_count",
                    blockInstanceCoordinates.MirroredOccurrenceCount,
                "block_instance_diagnostic_count",
                    blockInstanceCoordinates.Diagnostics.Count,
                "block_instance_coordinate_elapsed_ms",
                    Math.Round(blockInstanceWatch.Elapsed.TotalMilliseconds, 1),
                "planar_topology_status", planarTopology.Status,
                "planar_topology_input_segment_count", planarTopology.InputSegmentCount,
                "planar_topology_vertex_count", planarTopology.Vertices.Count,
                "planar_topology_edge_count", planarTopology.Edges.Count,
                "planar_topology_face_count", planarTopology.Faces.Count,
                "planar_topology_component_count", planarTopology.Components.Count,
                "planar_topology_ring_count", planarTopology.RingCount,
                "planar_topology_degenerate_ring_count", planarTopology.DegenerateRingCount,
                "planar_topology_unresolved_cycle_count", planarTopology.UnresolvedCycleCount,
                "planar_topology_diagnostic_count", planarTopology.Diagnostics.Count,
                "planar_topology_elapsed_ms",
                    Math.Round(planarTopologyWatch.Elapsed.TotalMilliseconds, 1),
                "engineering_view_region_status", engineeringViewRegions.Status,
                "engineering_view_region_count", engineeringViewRegions.Regions.Count,
                "engineering_view_candidate_count",
                    engineeringViewRegions.EngineeringViewCandidateCount,
                "engineering_view_documentation_region_count",
                    engineeringViewRegions.DocumentationRegionCount,
                "engineering_view_region_diagnostic_count",
                    engineeringViewRegions.Diagnostics.Count,
                "engineering_view_region_elapsed_ms",
                    Math.Round(engineeringViewRegionWatch.Elapsed.TotalMilliseconds, 1),
                "representation_correspondence_status",
                    representationCorrespondence.Status,
                "representation_signature_count",
                    representationCorrespondence.RegionSignatures.Count,
                "representation_repeated_family_count",
                    representationCorrespondence.RepeatedFamilies.Count,
                "representation_repeated_geometry_relation_count",
                    representationCorrespondence.RepeatedGeometryRelationCount,
                "representation_orthographic_projection_relation_count",
                    representationCorrespondence.OrthographicProjectionRelationCount,
                "representation_correspondence_diagnostic_count",
                    representationCorrespondence.Diagnostics.Count,
                "representation_correspondence_elapsed_ms",
                    Math.Round(
                        representationCorrespondenceWatch.Elapsed.TotalMilliseconds,
                        1),
                "representation_identity_status", representationIdentity.Status,
                "identity_representation_count",
                    representationIdentity.Representations.Count,
                "identity_assertion_count",
                    representationIdentity.Assertions.Count,
                "physical_object_cluster_count",
                    representationIdentity.PhysicalObjectClusters.Count,
                "merged_physical_object_cluster_count",
                    representationIdentity.MergedPhysicalObjectClusterCount,
                "same_object_possible_group_count",
                    representationIdentity.SameObjectPossibleGroups.Count,
                "type_candidate_group_count",
                    representationIdentity.TypeCandidateGroups.Count,
                "blocked_identity_merge_count",
                    representationIdentity.BlockedMerges.Count,
                "representation_identity_diagnostic_count",
                    representationIdentity.Diagnostics.Count,
                "representation_identity_elapsed_ms",
                    Math.Round(representationIdentityWatch.Elapsed.TotalMilliseconds, 1),
                "manufacturing_profile_status", manufacturingProfiles.Status,
                "manufacturing_profile_count", manufacturingProfiles.Profiles.Count,
                "manufacturing_unassigned_face_count",
                    manufacturingProfiles.UnassignedFaceCount,
                "manufacturing_void_boundary_candidate_count",
                    manufacturingProfiles.VoidBoundaries.Count,
                "manufacturing_circular_void_boundary_candidate_count",
                    manufacturingProfiles.CircularVoidBoundaryCount,
                "manufacturing_profile_adjacency_count",
                    manufacturingProfiles.Adjacencies.Count,
                "manufacturing_repeated_feature_group_count",
                    manufacturingProfiles.RepeatedFeatureGroups.Count,
                "manufacturing_open_boundary_candidate_count",
                    manufacturingProfiles.OpenBoundaries.Count,
                "manufacturing_object_summary_count",
                    manufacturingProfiles.ObjectSummaries.Count,
                "manufacturing_profile_diagnostic_count",
                    manufacturingProfiles.Diagnostics.Count,
                "manufacturing_profile_elapsed_ms",
                    Math.Round(manufacturingProfileWatch.Elapsed.TotalMilliseconds, 1),
                "mechanical_interface_adjacency_status", mechanicalInterfaces.Status,
                "mechanical_interface_feature_candidate_count",
                    mechanicalInterfaces.Features.Count,
                "mechanical_interface_circular_feature_candidate_count",
                    mechanicalInterfaces.CircularFeatureCount,
                "mechanical_interface_pattern_count", mechanicalInterfaces.Patterns.Count,
                "mechanical_interface_coaxial_pattern_candidate_count",
                    mechanicalInterfaces.CoaxialPatternCount,
                "mechanical_interface_aligned_nested_pattern_candidate_count",
                    mechanicalInterfaces.AlignedNestedPatternCount,
                "mechanical_interface_repeated_pattern_candidate_count",
                    mechanicalInterfaces.RepeatedPatternCount,
                "mechanical_adjacency_evidence_count",
                    mechanicalInterfaces.Adjacencies.Count,
                "mechanical_coincident_boundary_candidate_count",
                    mechanicalInterfaces.CoincidentBoundaryCount,
                "mechanical_open_terminal_approach_candidate_count",
                    mechanicalInterfaces.TerminalApproachCount,
                "mechanical_interface_object_summary_count",
                    mechanicalInterfaces.ObjectSummaries.Count,
                "mechanical_interface_diagnostic_count",
                    mechanicalInterfaces.Diagnostics.Count,
                "mechanical_interface_adjacency_elapsed_ms",
                    Math.Round(mechanicalInterfaceWatch.Elapsed.TotalMilliseconds, 1),
                "dimension_geometry_binding_status", dimensionGeometryBindings.Status,
                "dimension_geometry_input_dimension_count",
                    dimensionGeometryBindings.InputDimensionCount,
                "dimension_geometry_input_placement_count",
                    dimensionGeometryBindings.InputPlacementCount,
                "dimension_geometry_unplaced_source_dimension_count",
                    dimensionGeometryBindings.UnplacedSourceDimensionHandles.Count,
                "dimension_geometry_unique_binding_count",
                    dimensionGeometryBindings.UniqueBindingCount,
                "dimension_geometry_ambiguous_binding_count",
                    dimensionGeometryBindings.AmbiguousBindingCount,
                "dimension_geometry_partial_binding_count",
                    dimensionGeometryBindings.PartialBindingCount,
                "dimension_geometry_unbound_placement_count",
                    dimensionGeometryBindings.UnboundPlacementCount,
                "dimension_geometry_comparable_binding_count",
                    dimensionGeometryBindings.ComparableBindingCount,
                "dimension_geometry_numeric_text_override_count",
                    dimensionGeometryBindings.NumericOverrideCount,
                "dimension_geometry_outside_tolerance_candidate_count",
                    dimensionGeometryBindings.OutsideToleranceCandidateCount,
                "dimension_geometry_display_scale_hypothesis_count",
                    dimensionGeometryBindings.DisplayScaleHypotheses.Count,
                "dimension_geometry_scale_explained_outside_candidate_count",
                    dimensionGeometryBindings.ScaleExplainedOutsideCandidateCount,
                "dimension_geometry_unexplained_outside_candidate_count",
                    dimensionGeometryBindings.UnexplainedOutsideCandidateCount,
                "dimension_geometry_object_summary_count",
                    dimensionGeometryBindings.ObjectSummaries.Count,
                "dimension_geometry_diagnostic_count",
                    dimensionGeometryBindings.Diagnostics.Count,
                "dimension_geometry_binding_elapsed_ms",
                    Math.Round(
                        dimensionGeometryBindingWatch.Elapsed.TotalMilliseconds,
                        1),
                "semantic_drawing_snapshot_status", semanticDrawingSnapshot.Status,
                "semantic_drawing_snapshot_element_count",
                    semanticDrawingSnapshot.Elements.Count,
                "semantic_drawing_snapshot_domain_counts",
                    semanticDrawingSnapshot.DomainCounts,
                "semantic_drawing_snapshot_issue_count",
                    semanticDrawingSnapshot.Issues.Count,
                "semantic_drawing_snapshot_diagnostic_count",
                    semanticDrawingSnapshot.Diagnostics.Count,
                "semantic_drawing_snapshot_truncated",
                    semanticDrawingSnapshot.Truncated,
                "semantic_drawing_snapshot_elapsed_ms",
                    Math.Round(
                        semanticDrawingSnapshotWatch.Elapsed.TotalMilliseconds,
                        1),
                "cross_drawing_observation_component_reference_count",
                    crossDrawingObservation.ComponentReferences.Count,
                "cross_drawing_observation_interface_reference_count",
                    crossDrawingObservation.Interfaces.Count,
                "cross_drawing_observation_elapsed_ms",
                    Math.Round(
                        crossDrawingObservationWatch.Elapsed.TotalMilliseconds,
                        1),
                "output_dir", outDir);

            var semantic = Map(
                "schema_version", SchemaVersion,
                "source", SourceTag,
                "drawing_id", drawingId,
                "title_blocks", titleBlocks,
                "bom_rows", bomRows,
                "bom_knowledge", bomKnowledgeMap,
                "technical_requirements", technicalRequirementsMap,
                "annotations", annotationIdentificationMap,
                "dimension_topology", dimensionTopologyMap,
                "engineering_line_semantics", engineeringLineSemanticsMap,
                "block_instance_coordinate_facts", Map(
                    "artifact", "block-instance-coordinate-facts.json",
                    "occurrence_count", blockInstanceCoordinates.Occurrences.Count,
                    "curve_occurrence_count", blockInstanceCoordinates.CurveOccurrenceCount,
                    "diagnostic_count", blockInstanceCoordinates.Diagnostics.Count),
                "planar_topology", Map(
                    "artifact", "planar-topology.json",
                    "status", planarTopology.Status,
                    "vertex_count", planarTopology.Vertices.Count,
                    "edge_count", planarTopology.Edges.Count,
                    "bounded_face_count", planarTopology.Faces.Count,
                    "diagnostic_count", planarTopology.Diagnostics.Count),
                "engineering_view_regions", Map(
                    "artifact", "engineering-view-regions.json",
                    "status", engineeringViewRegions.Status,
                    "region_count", engineeringViewRegions.Regions.Count,
                    "engineering_view_candidate_count",
                        engineeringViewRegions.EngineeringViewCandidateCount,
                    "documentation_region_count",
                        engineeringViewRegions.DocumentationRegionCount,
                    "diagnostic_count", engineeringViewRegions.Diagnostics.Count),
                "representation_correspondence", Map(
                    "artifact", "representation-correspondence.json",
                    "status", representationCorrespondence.Status,
                    "signature_count",
                        representationCorrespondence.RegionSignatures.Count,
                    "repeated_family_count",
                        representationCorrespondence.RepeatedFamilies.Count,
                    "repeated_geometry_relation_count",
                        representationCorrespondence.RepeatedGeometryRelationCount,
                    "orthographic_projection_relation_count",
                        representationCorrespondence.OrthographicProjectionRelationCount,
                    "diagnostic_count",
                        representationCorrespondence.Diagnostics.Count),
                "representation_identity_resolution", Map(
                    "artifact", "representation-identity-resolution.json",
                    "status", representationIdentity.Status,
                    "representation_count", representationIdentity.Representations.Count,
                    "assertion_count", representationIdentity.Assertions.Count,
                    "physical_object_cluster_count",
                        representationIdentity.PhysicalObjectClusters.Count,
                    "merged_physical_object_cluster_count",
                        representationIdentity.MergedPhysicalObjectClusterCount,
                    "same_object_possible_group_count",
                        representationIdentity.SameObjectPossibleGroups.Count,
                    "type_candidate_group_count",
                        representationIdentity.TypeCandidateGroups.Count,
                    "blocked_merge_count", representationIdentity.BlockedMerges.Count,
                    "diagnostic_count", representationIdentity.Diagnostics.Count),
                "manufacturing_profile_features", Map(
                    "artifact", "manufacturing-profile-features.json",
                    "status", manufacturingProfiles.Status,
                    "profile_count", manufacturingProfiles.Profiles.Count,
                    "unassigned_face_count", manufacturingProfiles.UnassignedFaceCount,
                    "void_boundary_candidate_count",
                        manufacturingProfiles.VoidBoundaries.Count,
                    "circular_void_boundary_candidate_count",
                        manufacturingProfiles.CircularVoidBoundaryCount,
                    "profile_adjacency_count", manufacturingProfiles.Adjacencies.Count,
                    "repeated_feature_group_count",
                        manufacturingProfiles.RepeatedFeatureGroups.Count,
                    "open_boundary_candidate_count",
                        manufacturingProfiles.OpenBoundaries.Count,
                    "object_summary_count", manufacturingProfiles.ObjectSummaries.Count,
                    "diagnostic_count", manufacturingProfiles.Diagnostics.Count),
                "mechanical_interface_adjacency", Map(
                    "artifact", "mechanical-interface-adjacency.json",
                    "status", mechanicalInterfaces.Status,
                    "interface_feature_candidate_count",
                        mechanicalInterfaces.Features.Count,
                    "circular_feature_candidate_count",
                        mechanicalInterfaces.CircularFeatureCount,
                    "interface_pattern_count", mechanicalInterfaces.Patterns.Count,
                    "coaxial_pattern_candidate_count",
                        mechanicalInterfaces.CoaxialPatternCount,
                    "aligned_nested_pattern_candidate_count",
                        mechanicalInterfaces.AlignedNestedPatternCount,
                    "repeated_pattern_candidate_count",
                        mechanicalInterfaces.RepeatedPatternCount,
                    "adjacency_evidence_count", mechanicalInterfaces.Adjacencies.Count,
                    "coincident_boundary_candidate_count",
                        mechanicalInterfaces.CoincidentBoundaryCount,
                    "open_terminal_approach_candidate_count",
                        mechanicalInterfaces.TerminalApproachCount,
                    "object_summary_count", mechanicalInterfaces.ObjectSummaries.Count,
                    "diagnostic_count", mechanicalInterfaces.Diagnostics.Count),
                "dimension_geometry_binding", Map(
                    "artifact", "dimension-geometry-binding.json",
                    "status", dimensionGeometryBindings.Status,
                    "input_dimension_count", dimensionGeometryBindings.InputDimensionCount,
                    "input_placement_count", dimensionGeometryBindings.InputPlacementCount,
                    "unplaced_source_dimension_count",
                        dimensionGeometryBindings.UnplacedSourceDimensionHandles.Count,
                    "unique_binding_count", dimensionGeometryBindings.UniqueBindingCount,
                    "ambiguous_binding_count",
                        dimensionGeometryBindings.AmbiguousBindingCount,
                    "partial_binding_count", dimensionGeometryBindings.PartialBindingCount,
                    "unbound_placement_count",
                        dimensionGeometryBindings.UnboundPlacementCount,
                    "comparable_binding_count",
                        dimensionGeometryBindings.ComparableBindingCount,
                    "numeric_text_override_count",
                        dimensionGeometryBindings.NumericOverrideCount,
                    "outside_tolerance_candidate_count",
                        dimensionGeometryBindings.OutsideToleranceCandidateCount,
                    "display_scale_hypothesis_count",
                        dimensionGeometryBindings.DisplayScaleHypotheses.Count,
                    "scale_explained_outside_candidate_count",
                        dimensionGeometryBindings.ScaleExplainedOutsideCandidateCount,
                    "unexplained_outside_candidate_count",
                        dimensionGeometryBindings.UnexplainedOutsideCandidateCount,
                    "object_summary_count", dimensionGeometryBindings.ObjectSummaries.Count,
                    "diagnostic_count", dimensionGeometryBindings.Diagnostics.Count),
                "semantic_drawing_snapshot", Map(
                    "artifact", "semantic-drawing-snapshot.json",
                    "status", semanticDrawingSnapshot.Status,
                    "snapshot_id", semanticDrawingSnapshot.SnapshotId,
                    "drawing_key", semanticDrawingSnapshot.Identity.DrawingKey,
                    "revision", semanticDrawingSnapshot.Identity.Revision,
                    "stage", semanticDrawingSnapshot.Identity.Stage,
                    "element_count", semanticDrawingSnapshot.Elements.Count,
                    "domain_counts", semanticDrawingSnapshot.DomainCounts,
                    "issue_count", semanticDrawingSnapshot.Issues.Count,
                    "diagnostic_count", semanticDrawingSnapshot.Diagnostics.Count,
                    "truncated", semanticDrawingSnapshot.Truncated),
                "cross_drawing_project_observation", Map(
                    "artifact", "cross-drawing-observation.json",
                    "scope", "single_drawing_project_graph_input",
                    "drawing_node_id", crossDrawingObservation.NodeId,
                    "component_reference_count",
                        crossDrawingObservation.ComponentReferences.Count,
                    "interface_reference_count",
                        crossDrawingObservation.Interfaces.Count,
                    "project_graph_status", "requires_multiple_drawing_observations"),
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
                Path.Combine(outDir, "centerline-identification.json"),
                JsonUtil.Serialize(centerlineIdentificationMap));
            AtomicWrite(
                Path.Combine(outDir, "centerline-identification.md"),
                centerlineIdentification.ToMarkdown());
            AtomicWrite(
                Path.Combine(outDir, "annotation-identification.json"),
                JsonUtil.Serialize(annotationIdentificationMap));
            AtomicWrite(
                Path.Combine(outDir, "annotation-identification.md"),
                annotationIdentification.ToMarkdown());
            AtomicWrite(
                Path.Combine(outDir, "dimension-topology.json"),
                JsonUtil.Serialize(dimensionTopologyMap));
            AtomicWrite(
                Path.Combine(outDir, "dimension-topology.md"),
                dimensionTopology.ToMarkdown());
            AtomicWrite(
                Path.Combine(outDir, "engineering-line-semantics.json"),
                JsonUtil.Serialize(engineeringLineSemanticsMap));
            AtomicWrite(
                Path.Combine(outDir, "engineering-line-semantics.md"),
                engineeringLineSemantics.ToMarkdown());
            AtomicWrite(
                Path.Combine(outDir, "block-instance-coordinate-facts.json"),
                JsonUtil.Serialize(blockInstanceCoordinatesMap));
            AtomicWrite(
                Path.Combine(outDir, "block-instance-coordinate-facts.md"),
                blockInstanceCoordinates.ToMarkdown());
            AtomicWrite(
                Path.Combine(outDir, "planar-topology.json"),
                JsonUtil.Serialize(planarTopologyMap));
            AtomicWrite(
                Path.Combine(outDir, "planar-topology.md"),
                planarTopology.ToMarkdown());
            AtomicWrite(
                Path.Combine(outDir, "engineering-view-regions.json"),
                JsonUtil.Serialize(engineeringViewRegionsMap));
            AtomicWrite(
                Path.Combine(outDir, "engineering-view-regions.md"),
                engineeringViewRegions.ToMarkdown());
            AtomicWrite(
                Path.Combine(outDir, "representation-correspondence.json"),
                JsonUtil.Serialize(representationCorrespondenceMap));
            AtomicWrite(
                Path.Combine(outDir, "representation-correspondence.md"),
                representationCorrespondence.ToMarkdown());
            AtomicWrite(
                Path.Combine(outDir, "representation-identity-resolution.json"),
                JsonUtil.Serialize(representationIdentityMap));
            AtomicWrite(
                Path.Combine(outDir, "representation-identity-resolution.md"),
                representationIdentity.ToMarkdown());
            AtomicWrite(
                Path.Combine(outDir, "manufacturing-profile-features.json"),
                JsonUtil.Serialize(manufacturingProfilesMap));
            AtomicWrite(
                Path.Combine(outDir, "manufacturing-profile-features.md"),
                manufacturingProfiles.ToMarkdown());
            AtomicWrite(
                Path.Combine(outDir, "mechanical-interface-adjacency.json"),
                JsonUtil.Serialize(mechanicalInterfacesMap));
            AtomicWrite(
                Path.Combine(outDir, "mechanical-interface-adjacency.md"),
                mechanicalInterfaces.ToMarkdown());
            AtomicWrite(
                Path.Combine(outDir, "dimension-geometry-binding.json"),
                JsonUtil.Serialize(dimensionGeometryBindingsMap));
            AtomicWrite(
                Path.Combine(outDir, "dimension-geometry-binding.md"),
                dimensionGeometryBindings.ToMarkdown());
            AtomicWrite(
                Path.Combine(outDir, "semantic-drawing-snapshot.json"),
                JsonUtil.Serialize(semanticDrawingSnapshotMap));
            AtomicWrite(
                Path.Combine(outDir, "semantic-drawing-snapshot.md"),
                semanticDrawingSnapshot.ToMarkdown());
            AtomicWrite(
                Path.Combine(outDir, "cross-drawing-observation.json"),
                JsonUtil.Serialize(crossDrawingObservationMap));
            AtomicWrite(
                Path.Combine(outDir, "cross-drawing-observation.md"),
                crossDrawingObservation.ToMarkdown());
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
                        XuhaoAnnotationCoordinates xuhaoCoordinates =
                            XuhaoAnnotationCoordinateExtractor.Extract(ent);
                        Dictionary<string, object> record = SerializeEntity(
                            ent,
                            owner,
                            ownerScope,
                            tr,
                            xuhaoCoordinates);
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
            Transaction tr,
            XuhaoAnnotationCoordinates xuhaoCoordinates)
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
                { "geometry", GeometryOf(ent, tr, xuhaoCoordinates) },
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

        static Dictionary<string, object> GeometryOf(
            Entity ent,
            Transaction tr,
            XuhaoAnnotationCoordinates xuhaoCoordinates)
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
                        "block_transform", Safe(() => br.BlockTransform.ToArray()),
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
                    Dictionary<string, object> dimensionGeometry = Map(
                        "kind", "dimension",
                        "dim_type", dim.GetType().Name,
                        "measurement", Safe(() => dim.Measurement),
                        "text_position", Safe(() => Pt(dim.TextPosition)),
                        "dim_style", Safe(() => dim.DimensionStyleName),
                        "dim_linear_factor", Safe(() => dim.Dimlfac));
                    dimensionGeometry["definition_points"] =
                        DimensionDefinitionPoints(dim);
                    var rotatedDimension = dim as RotatedDimension;
                    if (rotatedDimension != null)
                    {
                        dimensionGeometry["rotation"] = rotatedDimension.Rotation;
                    }
                    return dimensionGeometry;
                }

                var leader = ent as Leader;
                if (leader != null)
                {
                    var vertices = new List<object>();
                    int vertexCount = leader.NumVertices;
                    for (int index = 0; index < vertexCount; index++)
                    {
                        vertices.Add(Pt(leader.VertexAt(index)));
                    }
                    return Map(
                        "kind", "leader",
                        "has_arrow_head", leader.HasArrowHead,
                        "vertex_count", vertexCount,
                        "vertices", vertices,
                        "dimension_style", Safe(() => leader.DimensionStyleName),
                        "annotation", LeaderAnnotationOf(leader, tr));
                }

                var mleader = ent as MLeader;
                if (mleader != null)
                {
                    System.Collections.ArrayList leaderIndexes =
                        mleader.GetLeaderIndexes();
                    int leaderLineCount = 0;
                    foreach (object rawLeaderIndex in leaderIndexes)
                    {
                        int leaderIndex = Convert.ToInt32(
                            rawLeaderIndex,
                            CultureInfo.InvariantCulture);
                        leaderLineCount += mleader.GetLeaderLineIndexes(leaderIndex).Count;
                    }
                    return Map(
                        "kind", "mleader",
                        "leader_count", leaderIndexes.Count,
                        "leader_line_count", leaderLineCount,
                        "has_content", Safe(() => mleader.HasContent()),
                        "content_type", Safe(() => mleader.ContentType.ToString()),
                        "text_location", Safe(() => Pt(mleader.TextLocation)),
                        "text", Safe(() => mleader.MText == null ? "" : mleader.MText.Text));
                }

                var solid = ent as Solid;
                if (solid != null)
                {
                    var points = new List<object>();
                    for (int index = 0; index < 4; index++)
                    {
                        points.Add(Pt(solid.GetPointAt((short)index)));
                    }
                    return Map("kind", "solid", "points", points);
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
                    Dictionary<string, object> professional = Map(
                        "kind", "professional",
                        "rx", rx,
                        "custom", CustomPayload(ent));
                    if (xuhaoCoordinates != null)
                    {
                        professional["pointing_position"] =
                            xuhaoCoordinates.PointingPosition;
                        professional["number_position"] =
                            xuhaoCoordinates.NumberPosition;
                    }
                    return professional;
                }

                return Map("kind", "unparsed", "managed_type", ent.GetType().Name);
            }
            catch (System.Exception ex)
            {
                return Map("kind", "error", "error", Clip(ex.Message, 512));
            }
        }

        static List<Dictionary<string, object>> DimensionDefinitionPoints(Dimension dimension)
        {
            var points = new List<Dictionary<string, object>>();
            var rotated = dimension as RotatedDimension;
            if (rotated != null)
            {
                points.Add(Map("role", "xline1", "point", Pt(rotated.XLine1Point)));
                points.Add(Map("role", "xline2", "point", Pt(rotated.XLine2Point)));
                points.Add(Map("role", "dimension_line", "point", Pt(rotated.DimLinePoint)));
                return points;
            }
            var aligned = dimension as AlignedDimension;
            if (aligned != null)
            {
                points.Add(Map("role", "xline1", "point", Pt(aligned.XLine1Point)));
                points.Add(Map("role", "xline2", "point", Pt(aligned.XLine2Point)));
                points.Add(Map("role", "dimension_line", "point", Pt(aligned.DimLinePoint)));
                return points;
            }
            var diametric = dimension as DiametricDimension;
            if (diametric != null)
            {
                points.Add(Map("role", "chord", "point", Pt(diametric.ChordPoint)));
                points.Add(Map("role", "far_chord", "point", Pt(diametric.FarChordPoint)));
                return points;
            }
            var radialLarge = dimension as RadialDimensionLarge;
            if (radialLarge != null)
            {
                points.Add(Map("role", "center", "point", Pt(radialLarge.Center)));
                points.Add(Map("role", "chord", "point", Pt(radialLarge.ChordPoint)));
                points.Add(Map("role", "jog", "point", Pt(radialLarge.JogPoint)));
                points.Add(Map("role", "override_center", "point", Pt(radialLarge.OverrideCenter)));
                return points;
            }
            var radial = dimension as RadialDimension;
            if (radial != null)
            {
                points.Add(Map("role", "center", "point", Pt(radial.Center)));
                points.Add(Map("role", "chord", "point", Pt(radial.ChordPoint)));
                return points;
            }
            var angular = dimension as LineAngularDimension2;
            if (angular != null)
            {
                points.Add(Map("role", "xline1_start", "point", Pt(angular.XLine1Start)));
                points.Add(Map("role", "xline1_end", "point", Pt(angular.XLine1End)));
                points.Add(Map("role", "xline2_start", "point", Pt(angular.XLine2Start)));
                points.Add(Map("role", "xline2_end", "point", Pt(angular.XLine2End)));
                points.Add(Map("role", "arc", "point", Pt(angular.ArcPoint)));
                return points;
            }
            var ordinate = dimension as OrdinateDimension;
            if (ordinate != null)
            {
                points.Add(Map("role", "origin", "point", Pt(ordinate.Origin)));
                points.Add(Map("role", "defining", "point", Pt(ordinate.DefiningPoint)));
                points.Add(Map("role", "leader_end", "point", Pt(ordinate.LeaderEndPoint)));
            }
            return points;
        }

        static Dictionary<string, object> LeaderAnnotationOf(Leader leader, Transaction tr)
        {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            try
            {
                ObjectId id = leader.Annotation;
                if (id.IsNull)
                {
                    return result;
                }
                Entity annotation = tr.GetObject(id, OpenMode.ForRead, false) as Entity;
                result["handle"] = annotation == null ? HandleOf(id) : HandleOf(annotation);
                result["runtime_class"] = annotation == null ? "" : RxName(annotation);
                result["text"] = annotation == null ? null : TextOf(annotation);
            }
            catch
            {
            }
            return result;
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

        static void DumpNamedObjects(
            Database db,
            Transaction tr,
            StreamWriter writer,
            IList<MechanicalBomAnnotationObservation> bomAnnotations,
            ISet<string> xuhaoEntityHandles,
            IDictionary<string, XuhaoAnnotationCoordinates> xuhaoCoordinatesByHandle)
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
                    if (string.Equals(
                        entry.Key,
                        "PC_BOMXHRELATEDIC",
                        StringComparison.Ordinal))
                    {
                        CollectMechanicalBomAnnotations(
                            child,
                            tr,
                            bomAnnotations,
                            xuhaoEntityHandles,
                            xuhaoCoordinatesByHandle);
                    }
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
                var layerColor = rec.Color;
                layers.Add(Map(
                    "name", rec.Name,
                    "handle", HandleOf(rec),
                    "off", rec.IsOff,
                    "frozen", rec.IsFrozen,
                    "locked", rec.IsLocked,
                    "color", layerColor.ToString(),
                    "color_detail", Map(
                        "index", layerColor.ColorIndex,
                        "is_by_layer", layerColor.IsByLayer,
                        "is_by_block", layerColor.IsByBlock,
                        "is_by_color", Safe(() => layerColor.IsByColor),
                        "method", Safe(() => layerColor.ColorMethod.ToString()),
                        "red", Safe(() => (int)layerColor.Red),
                        "green", Safe(() => (int)layerColor.Green),
                        "blue", Safe(() => (int)layerColor.Blue),
                        "name", layerColor.ToString()),
                    "lineweight", Safe(() => (int)rec.LineWeight),
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
                int dashCount = rec.NumDashes;
                var dashLengths = new List<double>();
                for (int index = 0; index < dashCount; index++)
                {
                    dashLengths.Add(rec.DashLengthAt(index));
                }
                linetypes.Add(Map(
                    "name", rec.Name,
                    "handle", HandleOf(rec),
                    "ascii_description", rec.AsciiDescription,
                    "comments", Safe(() => rec.Comments),
                    "pattern_length", rec.PatternLength,
                    "num_dashes", dashCount,
                    "dash_lengths", dashLengths));
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
                "plugin_version", "0.13.0",
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
                "bbox", record.ContainsKey("bbox") ? record["bbox"] : null,
                "xdata", record.ContainsKey("xdata") ? record["xdata"] : null,
                "fields", fields);
        }

        static KnownDocumentRegionObservation TitleBlockRegionObservationOf(
            Dictionary<string, object> record)
        {
            if (record == null
                || !string.Equals(
                    Convert.ToString(record["owner_scope"]),
                    "model_space",
                    StringComparison.Ordinal))
            {
                return null;
            }
            Dictionary<string, object> geometry = record.ContainsKey("geometry")
                ? record["geometry"] as Dictionary<string, object>
                : null;
            if (geometry == null
                || !geometry.ContainsKey("block_name")
                || !string.Equals(
                    Convert.ToString(geometry["block_name"]),
                    "PC_TITLE_BLOCK",
                    StringComparison.Ordinal))
            {
                return null;
            }
            Dictionary<string, object> bounds = record.ContainsKey("bbox")
                ? record["bbox"] as Dictionary<string, object>
                : null;
            System.Collections.IList minimum = bounds != null && bounds.ContainsKey("min")
                ? bounds["min"] as System.Collections.IList
                : null;
            System.Collections.IList maximum = bounds != null && bounds.ContainsKey("max")
                ? bounds["max"] as System.Collections.IList
                : null;
            if (minimum == null || maximum == null
                || minimum.Count < 2 || maximum.Count < 2)
            {
                return null;
            }
            return new KnownDocumentRegionObservation(
                "title-block:" + Convert.ToString(record["handle"]),
                "title_block",
                Convert.ToDouble(minimum[0], CultureInfo.InvariantCulture),
                Convert.ToDouble(minimum[1], CultureInfo.InvariantCulture),
                Convert.ToDouble(maximum[0], CultureInfo.InvariantCulture),
                Convert.ToDouble(maximum[1], CultureInfo.InvariantCulture));
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

        static DimensionTopologyObservation DimensionTopologyObservationOf(
            Dictionary<string, object> record)
        {
            Dictionary<string, object> geometry = record.ContainsKey("geometry")
                ? record["geometry"] as Dictionary<string, object>
                : null;
            if (geometry == null
                || !string.Equals(
                    StringValue(geometry, "kind"),
                    "dimension",
                    StringComparison.Ordinal))
            {
                return null;
            }

            var observation = new DimensionTopologyObservation(
                StringValue(record, "handle"),
                StringValue(record, "runtime_class"),
                StringValue(geometry, "dim_type"),
                StringValue(record, "layer"),
                StringValue(record, "owner_scope"),
                StringValue(record, "owner_block_name"));
            Dictionary<string, object> text = record.ContainsKey("text")
                ? record["text"] as Dictionary<string, object>
                : null;
            double measurement = NumberValue(geometry, "measurement", double.NaN);
            observation.SetMeasurement(
                double.IsNaN(measurement) ? (double?)null : measurement,
                StringValue(text, "dimension_text"),
                StringValue(geometry, "dim_style"));

            double rotation = NumberValue(geometry, "rotation", double.NaN);
            System.Collections.IList definitionPoints =
                geometry.ContainsKey("definition_points")
                    ? geometry["definition_points"] as System.Collections.IList
                    : null;
            if (definitionPoints != null)
            {
                foreach (object item in definitionPoints)
                {
                    Dictionary<string, object> definition =
                        item as Dictionary<string, object>;
                    if (definition == null)
                    {
                        continue;
                    }
                    string role = StringValue(definition, "role");
                    if (string.Equals(role, "rotation", StringComparison.Ordinal))
                    {
                        rotation = NumberValue(definition, "value", rotation);
                        continue;
                    }
                    object point = definition.ContainsKey("point")
                        ? definition["point"]
                        : null;
                    double x = CoordinateAt(point, 0, double.NaN);
                    double y = CoordinateAt(point, 1, double.NaN);
                    if (double.IsNaN(x) || double.IsNaN(y))
                    {
                        continue;
                    }
                    if (string.Equals(role, "xline1", StringComparison.Ordinal))
                    {
                        observation.SetXLine1Point(x, y);
                    }
                    else if (string.Equals(role, "xline2", StringComparison.Ordinal))
                    {
                        observation.SetXLine2Point(x, y);
                    }
                    else if (string.Equals(role, "dimension_line", StringComparison.Ordinal))
                    {
                        observation.SetDimensionLinePoint(x, y);
                    }
                }
            }
            observation.SetAxisAngle(
                double.IsNaN(rotation) ? (double?)null : rotation);

            object textPosition = geometry.ContainsKey("text_position")
                ? geometry["text_position"]
                : null;
            observation.SetTextPosition(
                CoordinateAt(textPosition, 0, double.NaN),
                CoordinateAt(textPosition, 1, double.NaN));
            Dictionary<string, object> bounds = record.ContainsKey("bbox")
                ? record["bbox"] as Dictionary<string, object>
                : null;
            if (bounds != null)
            {
                object min = bounds.ContainsKey("min") ? bounds["min"] : null;
                object max = bounds.ContainsKey("max") ? bounds["max"] : null;
                observation.SetBounds(
                    CoordinateAt(min, 0, double.NaN),
                    CoordinateAt(min, 1, double.NaN),
                    CoordinateAt(max, 0, double.NaN),
                    CoordinateAt(max, 1, double.NaN));
            }

            Dictionary<string, object> extensionDictionary =
                record.ContainsKey("extension_dictionary")
                    ? record["extension_dictionary"] as Dictionary<string, object>
                    : null;
            Dictionary<string, object> dictionaryItems =
                extensionDictionary != null && extensionDictionary.ContainsKey("items")
                    ? extensionDictionary["items"] as Dictionary<string, object>
                    : null;
            Dictionary<string, object> dimensionAssociation =
                dictionaryItems != null && dictionaryItems.ContainsKey("ACAD_DIMASSOC")
                    ? dictionaryItems["ACAD_DIMASSOC"] as Dictionary<string, object>
                    : null;
            observation.SetAssociationHandle(
                StringValue(dimensionAssociation, "handle"));
            double linearFactor = NumberValue(
                geometry,
                "dim_linear_factor",
                double.NaN);
            observation.SetLinearMeasurementFactor(
                double.IsNaN(linearFactor) ? (double?)null : linearFactor);
            return observation;
        }

        static List<DimensionReferenceAxisObservation> DimensionReferenceAxesOf(
            CenterlineIdentificationDocument centerlineIdentification)
        {
            var result = new List<DimensionReferenceAxisObservation>();
            if (centerlineIdentification == null)
            {
                return result;
            }
            var handles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (CenterlineRecord centerline in centerlineIdentification.Centerlines)
            {
                if (centerline == null
                    || !centerline.IsStraightLine
                    || centerline.LabelBindings.Count == 0
                    || !handles.Add(centerline.Handle))
                {
                    continue;
                }
                var labels = new List<string>();
                foreach (CenterlineLabelBinding binding in centerline.LabelBindings)
                {
                    string value = binding == null ? "" : binding.Text ?? "";
                    if (!string.IsNullOrEmpty(value) && !labels.Contains(value))
                    {
                        labels.Add(value);
                    }
                }
                if (labels.Count == 0)
                {
                    continue;
                }
                CenterlinePrimitiveObservation primitive = centerline.Primitive;
                result.Add(new DimensionReferenceAxisObservation(
                    centerline.Handle,
                    string.Join(" / ", labels.ToArray()),
                    centerline.OwnerScope,
                    centerline.OwnerBlockName,
                    primitive.StartX,
                    primitive.StartY,
                    primitive.EndX,
                    primitive.EndY));
            }
            return result;
        }

        static EngineeringLineObservation EngineeringLineObservationOf(
            Dictionary<string, object> record)
        {
            Dictionary<string, object> geometry = record.ContainsKey("geometry")
                ? record["geometry"] as Dictionary<string, object>
                : null;
            Dictionary<string, object> color = record.ContainsKey("color")
                ? record["color"] as Dictionary<string, object>
                : null;
            bool visible = !record.ContainsKey("visible")
                || record["visible"] == null
                || BooleanValue(record, "visible");
            var observation = new EngineeringLineObservation(
                StringValue(record, "handle"),
                StringValue(record, "runtime_class"),
                StringValue(record, "managed_type"),
                StringValue(record, "layer"),
                StringValue(record, "owner_scope"),
                StringValue(record, "owner_block_name"),
                StringValue(geometry, "kind"),
                visible);
            observation.SetEntityColor(
                NullableIntegerValue(color, "index"),
                BooleanValue(color, "is_by_layer"),
                BooleanValue(color, "is_by_block"),
                StringValue(color, "name"),
                StringValue(color, "method"),
                NullableIntegerValue(color, "red"),
                NullableIntegerValue(color, "green"),
                NullableIntegerValue(color, "blue"));
            observation.SetEntityStyle(
                StringValue(record, "linetype"),
                NullableIntegerValue(record, "lineweight"));

            Dictionary<string, object> bounds = record.ContainsKey("bbox")
                ? record["bbox"] as Dictionary<string, object>
                : null;
            if (bounds != null)
            {
                observation.SetBounds(
                    CoordinateAt(bounds.ContainsKey("min") ? bounds["min"] : null, 0, double.NaN),
                    CoordinateAt(bounds.ContainsKey("min") ? bounds["min"] : null, 1, double.NaN),
                    CoordinateAt(bounds.ContainsKey("max") ? bounds["max"] : null, 0, double.NaN),
                    CoordinateAt(bounds.ContainsKey("max") ? bounds["max"] : null, 1, double.NaN));
            }
            if (geometry == null)
            {
                return observation;
            }

            string kind = observation.GeometryKind;
            if (string.Equals(kind, "line", StringComparison.Ordinal))
            {
                observation.SetLine(
                    CoordinateAt(geometry.ContainsKey("start") ? geometry["start"] : null, 0, double.NaN),
                    CoordinateAt(geometry.ContainsKey("start") ? geometry["start"] : null, 1, double.NaN),
                    CoordinateAt(geometry.ContainsKey("end") ? geometry["end"] : null, 0, double.NaN),
                    CoordinateAt(geometry.ContainsKey("end") ? geometry["end"] : null, 1, double.NaN));
            }
            else if (string.Equals(kind, "arc", StringComparison.Ordinal))
            {
                observation.SetArc(
                    CoordinateAt(geometry.ContainsKey("center") ? geometry["center"] : null, 0, double.NaN),
                    CoordinateAt(geometry.ContainsKey("center") ? geometry["center"] : null, 1, double.NaN),
                    NumberValue(geometry, "radius", double.NaN),
                    NumberValue(geometry, "start_angle", double.NaN),
                    NumberValue(geometry, "end_angle", double.NaN));
            }
            else if (string.Equals(kind, "circle", StringComparison.Ordinal))
            {
                observation.SetCircle(
                    CoordinateAt(geometry.ContainsKey("center") ? geometry["center"] : null, 0, double.NaN),
                    CoordinateAt(geometry.ContainsKey("center") ? geometry["center"] : null, 1, double.NaN),
                    NumberValue(geometry, "radius", double.NaN));
            }
            else if (string.Equals(kind, "ellipse", StringComparison.Ordinal))
            {
                object center = geometry.ContainsKey("center") ? geometry["center"] : null;
                object majorAxis = geometry.ContainsKey("major_axis") ? geometry["major_axis"] : null;
                observation.SetEllipse(
                    CoordinateAt(center, 0, double.NaN),
                    CoordinateAt(center, 1, double.NaN),
                    CoordinateAt(majorAxis, 0, double.NaN),
                    CoordinateAt(majorAxis, 1, double.NaN),
                    NumberValue(geometry, "radius_ratio", double.NaN),
                    NumberValue(geometry, "start_angle", double.NaN),
                    NumberValue(geometry, "end_angle", double.NaN));
            }
            else if (string.Equals(kind, "lwpolyline", StringComparison.Ordinal)
                || string.Equals(kind, "polyline2d", StringComparison.Ordinal)
                || string.Equals(kind, "polyline3d", StringComparison.Ordinal))
            {
                observation.SetPath(
                    BooleanValue(geometry, "closed"),
                    EngineeringPathPointsOf(geometry, "vertices"));
            }
            else if (string.Equals(kind, "spline", StringComparison.Ordinal))
            {
                observation.SetPath(
                    BooleanValue(geometry, "closed"),
                    EngineeringPathPointsOf(geometry, "control_points"));
            }
            return observation;
        }

        static List<EngineeringLinePointObservation> EngineeringPathPointsOf(
            Dictionary<string, object> geometry,
            string key)
        {
            var result = new List<EngineeringLinePointObservation>();
            System.Collections.IList values = geometry != null && geometry.ContainsKey(key)
                ? geometry[key] as System.Collections.IList
                : null;
            if (values == null)
            {
                return result;
            }
            foreach (object value in values)
            {
                Dictionary<string, object> vertex = value as Dictionary<string, object>;
                object point = vertex != null && vertex.ContainsKey("point")
                    ? vertex["point"]
                    : value;
                double x = CoordinateAt(point, 0, double.NaN);
                double y = CoordinateAt(point, 1, double.NaN);
                if (!double.IsNaN(x) && !double.IsNaN(y))
                {
                    result.Add(new EngineeringLinePointObservation(
                        x,
                        y,
                        vertex == null ? 0 : NumberValue(vertex, "bulge", 0)));
                }
            }
            return result;
        }

        static InstanceEntityObservation InstanceEntityObservationOf(
            Dictionary<string, object> record,
            Entity entity,
            Transaction tr)
        {
            Dictionary<string, object> geometry = record.ContainsKey("geometry")
                ? record["geometry"] as Dictionary<string, object>
                : null;
            Dictionary<string, object> color = record.ContainsKey("color")
                ? record["color"] as Dictionary<string, object>
                : null;
            bool visible = !record.ContainsKey("visible")
                || record["visible"] == null
                || BooleanValue(record, "visible");
            var result = new InstanceEntityObservation(
                StringValue(record, "handle"),
                StringValue(record, "runtime_class"),
                StringValue(record, "managed_type"),
                StringValue(geometry, "kind"),
                StringValue(record, "layer"),
                visible);
            string colorMode = color == null
                ? "unknown"
                : BooleanValue(color, "is_by_block")
                    ? "by_block"
                    : BooleanValue(color, "is_by_layer")
                        ? "by_layer"
                        : "explicit";
            var instanceColor = new InstanceColorObservation(
                colorMode,
                StringValue(color, "name"),
                NullableIntegerValue(color, "index"),
                NullableIntegerValue(color, "red"),
                NullableIntegerValue(color, "green"),
                NullableIntegerValue(color, "blue"));
            string rawLinetype = StringValue(record, "linetype");
            string linetypeMode = string.Equals(
                    rawLinetype,
                    "ByBlock",
                    StringComparison.OrdinalIgnoreCase)
                ? "by_block"
                : string.IsNullOrEmpty(rawLinetype)
                    || string.Equals(rawLinetype, "ByLayer", StringComparison.OrdinalIgnoreCase)
                        ? "by_layer"
                        : "explicit";
            int? rawLineweight = NullableIntegerValue(record, "lineweight");
            string lineweightMode = rawLineweight == -2
                ? "by_block"
                : rawLineweight.HasValue && rawLineweight.Value >= 0
                    ? "explicit"
                    : rawLineweight == -3
                        ? "default"
                        : "by_layer";
            result.SetRawStyle(
                instanceColor,
                linetypeMode,
                rawLinetype,
                lineweightMode,
                rawLineweight);

            BlockReference blockReference = entity as BlockReference;
            if (blockReference != null)
            {
                string targetHandle = "";
                string targetName = "";
                string authoringHandle = "";
                bool targetIsExternal = false;
                try
                {
                    var target = (BlockTableRecord)tr.GetObject(
                        blockReference.BlockTableRecord,
                        OpenMode.ForRead);
                    targetHandle = HandleOf(target);
                    targetName = target.Name;
                    targetIsExternal = target.IsFromExternalReference;
                }
                catch
                {
                }
                bool isDynamic = false;
                try
                {
                    isDynamic = blockReference.IsDynamicBlock;
                    if (isDynamic && !blockReference.DynamicBlockTableRecord.IsNull)
                    {
                        authoringHandle = HandleOf(blockReference.DynamicBlockTableRecord);
                    }
                }
                catch
                {
                }
                int rows = 1;
                int columns = 1;
                double rowSpacing = 0;
                double columnSpacing = 0;
                MInsertBlock multiple = blockReference as MInsertBlock;
                if (multiple != null)
                {
                    rows = multiple.Rows;
                    columns = multiple.Columns;
                    rowSpacing = multiple.RowSpacing;
                    columnSpacing = multiple.ColumnSpacing;
                }
                result.SetBlockReference(
                    targetHandle,
                    targetName,
                    authoringHandle,
                    InstanceTransformOf(blockReference.BlockTransform),
                    rows,
                    columns,
                    rowSpacing,
                    columnSpacing,
                    isDynamic,
                    targetIsExternal);
                return result;
            }

            bool closed;
            string quality;
            List<InstancePoint3Observation> path = InstanceCurvePathOf(
                entity,
                tr,
                out closed,
                out quality);
            if (path.Count >= 2)
            {
                result.SetPath(path, closed, quality);
            }
            return result;
        }

        static InstanceAffineTransformObservation InstanceTransformOf(Matrix3d matrix)
        {
            // Capturing transformed basis points avoids relying on host-specific
            // Matrix3d.ToArray row/column ordering.
            Point3d origin = Point3d.Origin.TransformBy(matrix);
            Point3d xPoint = new Point3d(1, 0, 0).TransformBy(matrix);
            Point3d yPoint = new Point3d(0, 1, 0).TransformBy(matrix);
            Point3d zPoint = new Point3d(0, 0, 1).TransformBy(matrix);
            return new InstanceAffineTransformObservation(
                xPoint.X - origin.X,
                yPoint.X - origin.X,
                zPoint.X - origin.X,
                origin.X,
                xPoint.Y - origin.Y,
                yPoint.Y - origin.Y,
                zPoint.Y - origin.Y,
                origin.Y,
                xPoint.Z - origin.Z,
                yPoint.Z - origin.Z,
                zPoint.Z - origin.Z,
                origin.Z);
        }

        static List<InstancePoint3Observation> InstanceCurvePathOf(
            Entity entity,
            Transaction tr,
            out bool closed,
            out string quality)
        {
            closed = false;
            quality = "unsupported_geometry";
            var result = new List<InstancePoint3Observation>();
            Line line = entity as Line;
            if (line != null)
            {
                result.Add(InstancePoint(line.StartPoint));
                result.Add(InstancePoint(line.EndPoint));
                quality = "exact_linear_segment";
                return result;
            }
            Polyline polyline = entity as Polyline;
            if (polyline != null)
            {
                closed = polyline.Closed;
                bool hasBulge = false;
                for (int index = 0; index < polyline.NumberOfVertices; index++)
                {
                    if (Math.Abs(polyline.GetBulgeAt(index)) > 0.0000000001)
                    {
                        hasBulge = true;
                        break;
                    }
                }
                if (!hasBulge)
                {
                    for (int index = 0; index < polyline.NumberOfVertices; index++)
                    {
                        result.Add(InstancePoint(polyline.GetPoint3dAt(index)));
                    }
                    quality = "exact_linear_polyline";
                    return result;
                }
                return SamplePolyline(polyline, out closed, out quality);
            }
            Polyline2d polyline2d = entity as Polyline2d;
            if (polyline2d != null)
            {
                closed = polyline2d.Closed;
                bool hasBulge = false;
                foreach (ObjectId vertexId in polyline2d)
                {
                    Vertex2d vertex = tr.GetObject(vertexId, OpenMode.ForRead) as Vertex2d;
                    if (vertex == null) { continue; }
                    result.Add(InstancePoint(vertex.Position));
                    hasBulge = hasBulge || Math.Abs(vertex.Bulge) > 0.0000000001;
                }
                if (!hasBulge)
                {
                    quality = "exact_linear_polyline2d";
                    return result;
                }
                result.Clear();
                return SampleCurve(polyline2d, 0, out closed, out quality);
            }
            Polyline3d polyline3d = entity as Polyline3d;
            if (polyline3d != null)
            {
                closed = polyline3d.Closed;
                foreach (ObjectId vertexId in polyline3d)
                {
                    PolylineVertex3d vertex = tr.GetObject(
                        vertexId,
                        OpenMode.ForRead) as PolylineVertex3d;
                    if (vertex != null)
                    {
                        result.Add(InstancePoint(vertex.Position));
                    }
                }
                quality = "exact_linear_polyline3d";
                return result;
            }
            Curve curve = entity as Curve;
            if (curve == null)
            {
                return result;
            }
            int requestedSegments = 0;
            Arc arc = curve as Arc;
            if (arc != null)
            {
                requestedSegments = CircularSampleCount(
                    arc.Radius,
                    PositiveAngleSpan(arc.StartAngle, arc.EndAngle),
                    false);
            }
            Circle circle = curve as Circle;
            if (circle != null)
            {
                requestedSegments = CircularSampleCount(
                    circle.Radius,
                    Math.PI * 2.0,
                    true);
            }
            Ellipse ellipse = curve as Ellipse;
            if (ellipse != null)
            {
                requestedSegments = CircularSampleCount(
                    ellipse.MajorAxis.Length,
                    PositiveAngleSpan(ellipse.StartAngle, ellipse.EndAngle),
                    Math.Abs(PositiveAngleSpan(
                        ellipse.StartAngle,
                        ellipse.EndAngle) - Math.PI * 2.0) <= 0.000001);
            }
            Spline spline = curve as Spline;
            if (spline != null)
            {
                requestedSegments = Math.Max(32, Math.Min(1024, spline.NumControlPoints * 8));
            }
            return SampleCurve(curve, requestedSegments, out closed, out quality);
        }

        static List<InstancePoint3Observation> SamplePolyline(
            Polyline polyline,
            out bool closed,
            out string quality)
        {
            closed = polyline.Closed;
            quality = "adaptive_bulge_tessellation";
            var result = new List<InstancePoint3Observation>();
            int vertexCount = polyline.NumberOfVertices;
            int segmentCount = closed ? vertexCount : Math.Max(0, vertexCount - 1);
            for (int segment = 0; segment < segmentCount; segment++)
            {
                double bulge = polyline.GetBulgeAt(segment);
                int steps = Math.Max(
                    1,
                    Math.Min(256, (int)Math.Ceiling(
                        Math.Abs(4.0 * Math.Atan(bulge)) / (Math.PI / 36.0))));
                for (int step = 0; step < steps; step++)
                {
                    double parameter = segment + step / (double)steps;
                    result.Add(InstancePoint(polyline.GetPointAtParameter(parameter)));
                }
            }
            if (!closed && vertexCount > 0)
            {
                result.Add(InstancePoint(polyline.GetPoint3dAt(vertexCount - 1)));
            }
            return result;
        }

        static List<InstancePoint3Observation> SampleCurve(
            Curve curve,
            int requestedSegments,
            out bool closed,
            out string quality)
        {
            var result = new List<InstancePoint3Observation>();
            closed = false;
            quality = "curve_sampling_failed";
            try
            {
                closed = curve.Closed;
                double start = curve.StartParam;
                double end = curve.EndParam;
                int segmentCount = requestedSegments;
                if (segmentCount <= 0)
                {
                    segmentCount = Math.Max(
                        8,
                        Math.Min(1024, (int)Math.Ceiling(Math.Abs(end - start) * 8.0)));
                }
                int emitted = closed ? segmentCount : segmentCount + 1;
                for (int index = 0; index < emitted; index++)
                {
                    double parameter = start + (end - start) * index / segmentCount;
                    result.Add(InstancePoint(curve.GetPointAtParameter(parameter)));
                }
                quality = curve is Spline
                    ? "adaptive_parameter_tessellation_spline"
                    : "adaptive_parameter_tessellation_chord_target_0.05";
            }
            catch
            {
                result.Clear();
            }
            return result;
        }

        static int CircularSampleCount(double radius, double span, bool closed)
        {
            const double chordTarget = 0.05;
            radius = Math.Abs(radius);
            span = Math.Abs(span);
            if (!(radius > chordTarget) || !(span > 0))
            {
                return closed ? 16 : 4;
            }
            double cosine = Math.Max(-1, Math.Min(1, 1.0 - chordTarget / radius));
            double maximumAngle = 2.0 * Math.Acos(cosine);
            int count = maximumAngle > 0
                ? (int)Math.Ceiling(span / maximumAngle)
                : 64;
            return Math.Max(closed ? 16 : 2, Math.Min(2048, count));
        }

        static double PositiveAngleSpan(double start, double end)
        {
            double span = end - start;
            while (span < 0) { span += Math.PI * 2.0; }
            while (span > Math.PI * 2.0) { span -= Math.PI * 2.0; }
            return span;
        }

        static InstancePoint3Observation InstancePoint(Point3d point)
        {
            return new InstancePoint3Observation(point.X, point.Y, point.Z);
        }

        static List<InstanceLayerObservation> InstanceLayerObservationsOf(
            Dictionary<string, object> tables)
        {
            var result = new List<InstanceLayerObservation>();
            System.Collections.IList values = tables != null && tables.ContainsKey("layers")
                ? tables["layers"] as System.Collections.IList
                : null;
            if (values == null)
            {
                return result;
            }
            foreach (object value in values)
            {
                Dictionary<string, object> layer = value as Dictionary<string, object>;
                if (layer == null) { continue; }
                Dictionary<string, object> color = layer.ContainsKey("color_detail")
                    ? layer["color_detail"] as Dictionary<string, object>
                    : null;
                string colorMode = color == null
                    ? "unknown"
                    : BooleanValue(color, "is_by_block")
                        ? "by_block"
                        : BooleanValue(color, "is_by_layer")
                            ? "by_layer"
                            : "explicit";
                result.Add(new InstanceLayerObservation(
                    StringValue(layer, "name"),
                    new InstanceColorObservation(
                        colorMode,
                        color == null ? StringValue(layer, "color") : StringValue(color, "name"),
                        NullableIntegerValue(color, "index"),
                        NullableIntegerValue(color, "red"),
                        NullableIntegerValue(color, "green"),
                        NullableIntegerValue(color, "blue")),
                    StringValue(layer, "linetype"),
                    NullableIntegerValue(layer, "lineweight"),
                    BooleanValue(layer, "off"),
                    BooleanValue(layer, "frozen")));
            }
            return result;
        }

        static List<EngineeringLayerStyleObservation> EngineeringLayerStylesOf(
            Dictionary<string, object> tables)
        {
            var result = new List<EngineeringLayerStyleObservation>();
            System.Collections.IList values = tables != null && tables.ContainsKey("layers")
                ? tables["layers"] as System.Collections.IList
                : null;
            if (values == null)
            {
                return result;
            }
            foreach (object value in values)
            {
                Dictionary<string, object> layer = value as Dictionary<string, object>;
                if (layer == null)
                {
                    continue;
                }
                Dictionary<string, object> color = layer.ContainsKey("color_detail")
                    ? layer["color_detail"] as Dictionary<string, object>
                    : null;
                result.Add(new EngineeringLayerStyleObservation(
                    StringValue(layer, "name"),
                    color == null ? StringValue(layer, "color") : StringValue(color, "name"),
                    NullableIntegerValue(color, "index"),
                    BooleanValue(color, "is_by_layer"),
                    BooleanValue(color, "is_by_block"),
                    StringValue(color, "method"),
                    NullableIntegerValue(color, "red"),
                    NullableIntegerValue(color, "green"),
                    NullableIntegerValue(color, "blue"),
                    StringValue(layer, "linetype"),
                    NullableIntegerValue(layer, "lineweight")));
            }
            return result;
        }

        static List<EngineeringLinetypeDefinitionObservation>
            EngineeringLinetypeDefinitionsOf(Dictionary<string, object> tables)
        {
            var result = new List<EngineeringLinetypeDefinitionObservation>();
            System.Collections.IList values = tables != null && tables.ContainsKey("linetypes")
                ? tables["linetypes"] as System.Collections.IList
                : null;
            if (values == null)
            {
                return result;
            }
            foreach (object value in values)
            {
                Dictionary<string, object> linetype = value as Dictionary<string, object>;
                if (linetype == null)
                {
                    continue;
                }
                var dashes = new List<double>();
                System.Collections.IList raw = linetype.ContainsKey("dash_lengths")
                    ? linetype["dash_lengths"] as System.Collections.IList
                    : null;
                if (raw != null)
                {
                    foreach (object dash in raw)
                    {
                        try
                        {
                            dashes.Add(Convert.ToDouble(dash, CultureInfo.InvariantCulture));
                        }
                        catch
                        {
                        }
                    }
                }
                result.Add(new EngineeringLinetypeDefinitionObservation(
                    StringValue(linetype, "name"),
                    StringValue(linetype, "ascii_description"),
                    StringValue(linetype, "comments"),
                    NullableNumberValue(linetype, "pattern_length"),
                    dashes));
            }
            return result;
        }

        static List<string> CenterGeometryHandlesOf(
            CenterlineIdentificationDocument centerlineIdentification)
        {
            var result = new List<string>();
            if (centerlineIdentification == null)
            {
                return result;
            }
            foreach (CenterlineRecord centerline in centerlineIdentification.Centerlines)
            {
                if (centerline != null
                    && !string.IsNullOrEmpty(centerline.Handle)
                    && !result.Contains(centerline.Handle))
                {
                    result.Add(centerline.Handle);
                }
            }
            return result;
        }

        static List<EngineeringReferenceAxisObservation> EngineeringReferenceAxesOf(
            CenterlineIdentificationDocument centerlineIdentification,
            DimensionTopologyDocument dimensionTopology)
        {
            var result = new List<EngineeringReferenceAxisObservation>();
            var byHandle = new Dictionary<string, EngineeringReferenceAxisObservation>(
                StringComparer.OrdinalIgnoreCase);
            if (centerlineIdentification != null)
            {
                foreach (CenterlineRecord centerline in centerlineIdentification.Centerlines)
                {
                    if (centerline == null
                        || !centerline.IsStraightLine
                        || centerline.LabelBindings.Count == 0
                        || byHandle.ContainsKey(centerline.Handle))
                    {
                        continue;
                    }
                    var labels = new List<string>();
                    foreach (CenterlineLabelBinding binding in centerline.LabelBindings)
                    {
                        string label = binding == null ? "" : binding.Text ?? "";
                        if (!string.IsNullOrEmpty(label) && !labels.Contains(label))
                        {
                            labels.Add(label);
                        }
                    }
                    if (labels.Count == 0)
                    {
                        continue;
                    }
                    CenterlinePrimitiveObservation primitive = centerline.Primitive;
                    var axis = new EngineeringReferenceAxisObservation(
                        centerline.Handle,
                        string.Join(" / ", labels.ToArray()),
                        centerline.OwnerScope,
                        centerline.OwnerBlockName,
                        primitive.StartX,
                        primitive.StartY,
                        primitive.EndX,
                        primitive.EndY);
                    result.Add(axis);
                    byHandle.Add(axis.Handle, axis);
                }
            }
            if (dimensionTopology != null)
            {
                foreach (DimensionDatumProfileRecord profile in dimensionTopology.DatumProfiles)
                {
                    EngineeringReferenceAxisObservation axis;
                    if (profile == null
                        || !profile.HasConstantMidpointOffset
                        || string.IsNullOrEmpty(profile.ReferenceAxisHandle)
                        || !byHandle.TryGetValue(profile.ReferenceAxisHandle, out axis))
                    {
                        continue;
                    }
                    axis.AddCandidateShift(
                        profile.AxisX * profile.ConstantMidpointOffset,
                        profile.AxisY * profile.ConstantMidpointOffset,
                        "09_dimension_datum_profile:" + profile.Id);
                }
            }
            return result;
        }

        static AnnotationEntityObservation AnnotationEntityObservationOf(
            Dictionary<string, object> record)
        {
            Dictionary<string, object> geometry = record.ContainsKey("geometry")
                ? record["geometry"] as Dictionary<string, object>
                : null;
            Dictionary<string, object> color = record.ContainsKey("color")
                ? record["color"] as Dictionary<string, object>
                : null;
            var observation = new AnnotationEntityObservation(
                StringValue(record, "handle"),
                StringValue(record, "runtime_class"),
                StringValue(record, "managed_type"),
                StringValue(record, "layer"),
                IntegerValue(color, "index", -1),
                StringValue(record, "owner_scope"),
                StringValue(record, "owner_block_name"),
                StringValue(geometry, "kind"));

            Dictionary<string, object> bounds = record.ContainsKey("bbox")
                ? record["bbox"] as Dictionary<string, object>
                : null;
            if (bounds != null)
            {
                object min = bounds.ContainsKey("min") ? bounds["min"] : null;
                object max = bounds.ContainsKey("max") ? bounds["max"] : null;
                observation.SetBounds(
                    CoordinateAt(min, 0, double.NaN),
                    CoordinateAt(min, 1, double.NaN),
                    CoordinateAt(max, 0, double.NaN),
                    CoordinateAt(max, 1, double.NaN));
            }

            string visibleText = AnnotationVisibleTextOf(record);
            if (string.Equals(
                observation.RuntimeClass,
                "TH_XuHaoEntity",
                StringComparison.Ordinal)
                && string.IsNullOrEmpty(visibleText))
            {
                visibleText = ThXuhaoItemNumber(record);
            }
            observation.SetText(visibleText);

            if (geometry == null)
            {
                return observation;
            }
            string kind = observation.GeometryKind;
            if (string.Equals(kind, "dimension", StringComparison.Ordinal))
            {
                Dictionary<string, object> textMap = record.ContainsKey("text")
                    ? record["text"] as Dictionary<string, object>
                    : null;
                double measurement = NumberValue(geometry, "measurement", double.NaN);
                observation.SetDimension(
                    StringValue(geometry, "dim_type"),
                    double.IsNaN(measurement) ? (double?)null : measurement,
                    StringValue(textMap, "dimension_text"),
                    StringValue(geometry, "dim_style"));
                AddAnnotationPoint(observation, "text_position", geometry, "text_position");
                System.Collections.IList definitionPoints = geometry.ContainsKey("definition_points")
                    ? geometry["definition_points"] as System.Collections.IList
                    : null;
                if (definitionPoints != null)
                {
                    foreach (object item in definitionPoints)
                    {
                        Dictionary<string, object> definition =
                            item as Dictionary<string, object>;
                        if (definition == null)
                        {
                            continue;
                        }
                        AddAnnotationPoint(
                            observation,
                            StringValue(definition, "role"),
                            definition,
                            "point");
                    }
                }
            }
            else if (string.Equals(kind, "line", StringComparison.Ordinal))
            {
                AddAnnotationPoint(observation, "start", geometry, "start");
                AddAnnotationPoint(observation, "end", geometry, "end");
            }
            else if (string.Equals(kind, "solid", StringComparison.Ordinal))
            {
                System.Collections.IList points = geometry.ContainsKey("points")
                    ? geometry["points"] as System.Collections.IList
                    : null;
                if (points != null)
                {
                    for (int index = 0; index < points.Count; index++)
                    {
                        AddAnnotationPoint(
                            observation,
                            "solid_" + index.ToString(CultureInfo.InvariantCulture),
                            points[index]);
                    }
                }
            }
            else if (string.Equals(kind, "text", StringComparison.Ordinal))
            {
                AddAnnotationPoint(observation, "text_position", geometry, "position");
            }
            else if (string.Equals(kind, "mtext", StringComparison.Ordinal))
            {
                AddAnnotationPoint(observation, "text_location", geometry, "location");
            }
            else if (string.Equals(kind, "leader", StringComparison.Ordinal))
            {
                observation.SetHasArrowHead(BooleanValue(geometry, "has_arrow_head"));
                AddAnnotationPointList(observation, geometry, "vertices", "vertex_");
            }
            else if (string.Equals(kind, "mleader", StringComparison.Ordinal))
            {
                AddAnnotationPoint(observation, "text_location", geometry, "text_location");
            }
            else if (string.Equals(kind, "professional", StringComparison.Ordinal))
            {
                AddAnnotationPoint(observation, "pointing_position", geometry, "pointing_position");
                AddAnnotationPoint(observation, "number_position", geometry, "number_position");
            }
            return observation;
        }

        static string AnnotationVisibleTextOf(Dictionary<string, object> record)
        {
            var values = new List<string>();
            if (record.ContainsKey("text"))
            {
                CollectVisibleText(record["text"], values);
            }
            Dictionary<string, object> geometry = record.ContainsKey("geometry")
                ? record["geometry"] as Dictionary<string, object>
                : null;
            if (geometry != null)
            {
                if (geometry.ContainsKey("annotation"))
                {
                    CollectVisibleText(geometry["annotation"], values);
                }
                if (geometry.ContainsKey("text"))
                {
                    CollectVisibleText(geometry["text"], values);
                }
            }
            Dictionary<string, object> custom = record.ContainsKey("custom")
                ? record["custom"] as Dictionary<string, object>
                : null;
            System.Collections.IList exploded = custom != null && custom.ContainsKey("explode")
                ? custom["explode"] as System.Collections.IList
                : null;
            if (exploded != null)
            {
                foreach (object item in exploded)
                {
                    CollectVisibleText(item, values);
                }
            }
            return string.Join("\n", values.ToArray());
        }

        static void CollectVisibleText(object value, IList<string> output)
        {
            if (value == null || output == null)
            {
                return;
            }
            string direct = value as string;
            if (direct != null)
            {
                AddVisibleText(direct, output);
                return;
            }
            Dictionary<string, object> map = value as Dictionary<string, object>;
            if (map == null)
            {
                return;
            }
            string[] preferredKeys =
            {
                "plain", "string", "dimension_text", "contents", "value"
            };
            foreach (string key in preferredKeys)
            {
                if (!map.ContainsKey(key))
                {
                    continue;
                }
                object child = map[key];
                string childText = child as string;
                if (!string.IsNullOrWhiteSpace(childText))
                {
                    AddVisibleText(childText, output);
                    return;
                }
            }
            if (map.ContainsKey("text"))
            {
                CollectVisibleText(map["text"], output);
            }
        }

        static void AddVisibleText(string value, IList<string> output)
        {
            string normalized = (value ?? "").Trim();
            if (normalized.Length == 0 || output.Contains(normalized))
            {
                return;
            }
            output.Add(normalized);
        }

        static void AddAnnotationPoint(
            AnnotationEntityObservation observation,
            string role,
            Dictionary<string, object> values,
            string key)
        {
            if (values == null || !values.ContainsKey(key))
            {
                return;
            }
            AddAnnotationPoint(observation, role, values[key]);
        }

        static void AddAnnotationPoint(
            AnnotationEntityObservation observation,
            string role,
            object value)
        {
            double x = CoordinateAt(value, 0, double.NaN);
            double y = CoordinateAt(value, 1, double.NaN);
            if (!double.IsNaN(x) && !double.IsNaN(y))
            {
                observation.AddGeometryPoint(role, x, y);
            }
        }

        static void AddAnnotationPointList(
            AnnotationEntityObservation observation,
            Dictionary<string, object> values,
            string key,
            string rolePrefix)
        {
            System.Collections.IList points = values != null && values.ContainsKey(key)
                ? values[key] as System.Collections.IList
                : null;
            if (points == null)
            {
                return;
            }
            for (int index = 0; index < points.Count; index++)
            {
                AddAnnotationPoint(
                    observation,
                    rolePrefix + index.ToString(CultureInfo.InvariantCulture),
                    points[index]);
            }
        }

        static string StringValue(Dictionary<string, object> values, string key)
        {
            return values != null && values.ContainsKey(key) && values[key] != null
                ? Convert.ToString(values[key], CultureInfo.InvariantCulture) ?? ""
                : "";
        }

        static void AddExternalDrawingReferences(
            CrossDrawingDrawingObservation drawing,
            IEnumerable<Dictionary<string, object>> blockInventory)
        {
            if (drawing == null || blockInventory == null) { return; }
            foreach (Dictionary<string, object> block in blockInventory)
            {
                object flag;
                bool isExternal = block != null
                    && block.TryGetValue("is_from_xref", out flag)
                    && flag != null
                    && Convert.ToBoolean(flag, CultureInfo.InvariantCulture);
                if (!isExternal) { continue; }
                string path = StringValue(block, "xref_path");
                string name = StringValue(block, "name");
                string handle = StringValue(block, "handle");
                string stem = "";
                try
                {
                    stem = Path.GetFileNameWithoutExtension(path);
                }
                catch
                {
                    stem = path;
                }
                if (string.IsNullOrWhiteSpace(stem)) { stem = name; }
                if (string.IsNullOrWhiteSpace(stem)) { continue; }
                string referenceCode = stem;
                string referencedSheet = "";
                int separator = stem.LastIndexOf('_');
                int sheet;
                if (separator > 0 && separator + 1 < stem.Length
                    && int.TryParse(
                        stem.Substring(separator + 1),
                        NumberStyles.Integer,
                        CultureInfo.InvariantCulture,
                        out sheet)
                    && sheet > 0)
                {
                    referenceCode = stem.Substring(0, separator);
                    referencedSheet = sheet.ToString(CultureInfo.InvariantCulture);
                }
                var reference = new CrossDrawingComponentReferenceObservation(
                    "component-ref:xref:" + drawing.SnapshotId + ":" +
                        (string.IsNullOrEmpty(handle) ? stem : handle.ToUpperInvariant()),
                    referenceCode,
                    "authored_external_reference",
                    "xref-block:" + handle)
                    .SetBomContext("", name, "")
                    .SetReferenceQualifier(referencedSheet, "")
                    .SetSourceText(path);
                reference.AddSourceHandle(handle);
                drawing.AddComponentReference(reference);
            }
        }

        static int IntegerValue(
            Dictionary<string, object> values,
            string key,
            int fallback)
        {
            if (values == null || !values.ContainsKey(key) || values[key] == null)
            {
                return fallback;
            }
            try
            {
                return Convert.ToInt32(values[key], CultureInfo.InvariantCulture);
            }
            catch
            {
                return fallback;
            }
        }

        static int? NullableIntegerValue(
            Dictionary<string, object> values,
            string key)
        {
            if (values == null || !values.ContainsKey(key) || values[key] == null)
            {
                return null;
            }
            try
            {
                return Convert.ToInt32(values[key], CultureInfo.InvariantCulture);
            }
            catch
            {
                return null;
            }
        }

        static double? NullableNumberValue(
            Dictionary<string, object> values,
            string key)
        {
            if (values == null || !values.ContainsKey(key) || values[key] == null)
            {
                return null;
            }
            try
            {
                return Convert.ToDouble(values[key], CultureInfo.InvariantCulture);
            }
            catch
            {
                return null;
            }
        }

        static CenterlinePrimitiveObservation CenterlinePrimitiveObservationOf(
            Dictionary<string, object> record)
        {
            Dictionary<string, object> geometry = record.ContainsKey("geometry")
                ? record["geometry"] as Dictionary<string, object>
                : null;
            if (geometry == null)
            {
                return null;
            }
            string kind = geometry.ContainsKey("kind")
                ? Convert.ToString(geometry["kind"], CultureInfo.InvariantCulture) ?? ""
                : "";
            string handle = record.ContainsKey("handle")
                ? Convert.ToString(record["handle"], CultureInfo.InvariantCulture) ?? ""
                : "";
            string layer = record.ContainsKey("layer")
                ? Convert.ToString(record["layer"], CultureInfo.InvariantCulture) ?? ""
                : "";
            string entityLinetype = record.ContainsKey("linetype")
                ? Convert.ToString(record["linetype"], CultureInfo.InvariantCulture) ?? ""
                : "";
            string ownerScope = record.ContainsKey("owner_scope")
                ? Convert.ToString(record["owner_scope"], CultureInfo.InvariantCulture) ?? ""
                : "";
            string ownerBlockName = record.ContainsKey("owner_block_name")
                ? Convert.ToString(record["owner_block_name"], CultureInfo.InvariantCulture) ?? ""
                : "";

            if (string.Equals(kind, "line", StringComparison.Ordinal))
            {
                object start = geometry.ContainsKey("start") ? geometry["start"] : null;
                object end = geometry.ContainsKey("end") ? geometry["end"] : null;
                double startX = CoordinateAt(start, 0, double.NaN);
                double startY = CoordinateAt(start, 1, double.NaN);
                double endX = CoordinateAt(end, 0, double.NaN);
                double endY = CoordinateAt(end, 1, double.NaN);
                if (AnyNaN(startX, startY, endX, endY))
                {
                    return null;
                }
                return CenterlinePrimitiveObservation.CreateLine(
                    handle,
                    layer,
                    entityLinetype,
                    ownerScope,
                    ownerBlockName,
                    startX,
                    startY,
                    endX,
                    endY);
            }
            if (string.Equals(kind, "arc", StringComparison.Ordinal))
            {
                object center = geometry.ContainsKey("center") ? geometry["center"] : null;
                double centerX = CoordinateAt(center, 0, double.NaN);
                double centerY = CoordinateAt(center, 1, double.NaN);
                double radius = NumberValue(geometry, "radius", double.NaN);
                double startAngle = NumberValue(geometry, "start_angle", double.NaN);
                double endAngle = NumberValue(geometry, "end_angle", double.NaN);
                if (AnyNaN(centerX, centerY, radius, startAngle, endAngle))
                {
                    return null;
                }
                return CenterlinePrimitiveObservation.CreateArc(
                    handle,
                    layer,
                    entityLinetype,
                    ownerScope,
                    ownerBlockName,
                    centerX,
                    centerY,
                    radius,
                    startAngle,
                    endAngle);
            }
            if (string.Equals(kind, "circle", StringComparison.Ordinal))
            {
                object center = geometry.ContainsKey("center") ? geometry["center"] : null;
                double centerX = CoordinateAt(center, 0, double.NaN);
                double centerY = CoordinateAt(center, 1, double.NaN);
                double radius = NumberValue(geometry, "radius", double.NaN);
                if (AnyNaN(centerX, centerY, radius))
                {
                    return null;
                }
                return CenterlinePrimitiveObservation.CreateCircle(
                    handle,
                    layer,
                    entityLinetype,
                    ownerScope,
                    ownerBlockName,
                    centerX,
                    centerY,
                    radius);
            }
            if (string.Equals(kind, "lwpolyline", StringComparison.Ordinal))
            {
                var vertices = new List<CenterlineVertexObservation>();
                System.Collections.IList rawVertices = geometry.ContainsKey("vertices")
                    ? geometry["vertices"] as System.Collections.IList
                    : null;
                if (rawVertices == null)
                {
                    return null;
                }
                foreach (object item in rawVertices)
                {
                    Dictionary<string, object> vertex = item as Dictionary<string, object>;
                    if (vertex == null)
                    {
                        continue;
                    }
                    object point = vertex.ContainsKey("point") ? vertex["point"] : null;
                    double x = CoordinateAt(point, 0, double.NaN);
                    double y = CoordinateAt(point, 1, double.NaN);
                    if (!double.IsNaN(x) && !double.IsNaN(y))
                    {
                        vertices.Add(new CenterlineVertexObservation(
                            x,
                            y,
                            NumberValue(vertex, "bulge", 0)));
                    }
                }
                return CenterlinePrimitiveObservation.CreatePolyline(
                    handle,
                    layer,
                    entityLinetype,
                    ownerScope,
                    ownerBlockName,
                    BooleanValue(geometry, "closed"),
                    vertices);
            }
            if (string.Equals(kind, "spline", StringComparison.Ordinal))
            {
                var points = new List<CenterlinePointObservation>();
                System.Collections.IList rawPoints = geometry.ContainsKey("control_points")
                    ? geometry["control_points"] as System.Collections.IList
                    : null;
                if (rawPoints == null)
                {
                    return null;
                }
                foreach (object point in rawPoints)
                {
                    double x = CoordinateAt(point, 0, double.NaN);
                    double y = CoordinateAt(point, 1, double.NaN);
                    if (!double.IsNaN(x) && !double.IsNaN(y))
                    {
                        points.Add(new CenterlinePointObservation(x, y));
                    }
                }
                return CenterlinePrimitiveObservation.CreateSpline(
                    handle,
                    layer,
                    entityLinetype,
                    ownerScope,
                    ownerBlockName,
                    BooleanValue(geometry, "closed"),
                    points);
            }
            return null;
        }

        static CenterlineLabelLeaderObservation CenterlineLabelLeaderObservationOf(
            Dictionary<string, object> record)
        {
            string managedType = record.ContainsKey("managed_type")
                ? Convert.ToString(record["managed_type"], CultureInfo.InvariantCulture)
                : "";
            if (!string.Equals(managedType, "Leader", StringComparison.Ordinal))
            {
                return null;
            }

            Dictionary<string, object> custom = record.ContainsKey("custom")
                ? record["custom"] as Dictionary<string, object>
                : null;
            System.Collections.IList exploded = custom != null && custom.ContainsKey("explode")
                ? custom["explode"] as System.Collections.IList
                : null;
            if (exploded == null)
            {
                return null;
            }
            string value = "";
            foreach (object item in exploded)
            {
                Dictionary<string, object> part = item as Dictionary<string, object>;
                if (part == null)
                {
                    continue;
                }
                string candidate = "";
                if (part.ContainsKey("plain"))
                {
                    candidate = Convert.ToString(part["plain"], CultureInfo.InvariantCulture) ?? "";
                }
                else if (part.ContainsKey("string"))
                {
                    candidate = Convert.ToString(part["string"], CultureInfo.InvariantCulture) ?? "";
                }
                if (candidate.IndexOf("中心线", StringComparison.Ordinal) >= 0)
                {
                    value = candidate;
                    if (part.ContainsKey("plain"))
                    {
                        break;
                    }
                }
            }
            if (string.IsNullOrEmpty(value))
            {
                return null;
            }

            Dictionary<string, object> geometry = record.ContainsKey("geometry")
                ? record["geometry"] as Dictionary<string, object>
                : null;
            System.Collections.IList vertices = geometry != null && geometry.ContainsKey("vertices")
                ? geometry["vertices"] as System.Collections.IList
                : null;
            if (vertices == null || vertices.Count < 2)
            {
                return null;
            }
            object first = vertices[0];
            object last = vertices[vertices.Count - 1];
            double startX = CoordinateAt(first, 0, double.NaN);
            double startY = CoordinateAt(first, 1, double.NaN);
            double endX = CoordinateAt(last, 0, double.NaN);
            double endY = CoordinateAt(last, 1, double.NaN);
            if (double.IsNaN(startX)
                || double.IsNaN(startY)
                || double.IsNaN(endX)
                || double.IsNaN(endY))
            {
                return null;
            }

            return new CenterlineLabelLeaderObservation(
                record.ContainsKey("handle")
                    ? Convert.ToString(record["handle"], CultureInfo.InvariantCulture)
                    : "",
                record.ContainsKey("owner_scope")
                    ? Convert.ToString(record["owner_scope"], CultureInfo.InvariantCulture)
                    : "",
                record.ContainsKey("owner_block_name")
                    ? Convert.ToString(record["owner_block_name"], CultureInfo.InvariantCulture)
                    : "",
                value,
                startX,
                startY,
                endX,
                endY);
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

        static List<CenterlineLayerObservation> CenterlineLayerDefinitionsOf(
            Dictionary<string, object> tables)
        {
            var result = new List<CenterlineLayerObservation>();
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
                result.Add(new CenterlineLayerObservation(
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

        static void CollectMechanicalBomAnnotations(
            DBObject source,
            Transaction tr,
            IList<MechanicalBomAnnotationObservation> observations,
            ISet<string> xuhaoEntityHandles,
            IDictionary<string, XuhaoAnnotationCoordinates> xuhaoCoordinatesByHandle)
        {
            var dictionary = source as DBDictionary;
            if (dictionary == null || observations == null)
            {
                return;
            }

            foreach (DBDictionaryEntry entry in dictionary)
            {
                int itemNumber;
                string xuhaoHandle;
                if (!TryParseMechanicalBomAnnotationKey(
                    entry.Key,
                    out itemNumber,
                    out xuhaoHandle))
                {
                    continue;
                }

                DBObject association = null;
                try
                {
                    association = tr.GetObject(entry.Value, OpenMode.ForRead, false);
                }
                catch
                {
                }

                XuhaoAnnotationCoordinates coordinates = null;
                if (xuhaoCoordinatesByHandle != null)
                {
                    xuhaoCoordinatesByHandle.TryGetValue(xuhaoHandle, out coordinates);
                }

                observations.Add(new MechanicalBomAnnotationObservation(
                    itemNumber,
                    entry.Key,
                    xuhaoHandle,
                    association == null ? HandleOf(entry.Value) : HandleOf(association),
                    association == null ? "" : RxName(association),
                    xuhaoEntityHandles != null
                        && xuhaoEntityHandles.Contains(xuhaoHandle),
                    coordinates == null ? null : coordinates.PointingPosition,
                    coordinates == null ? null : coordinates.NumberPosition));
            }
        }

        static bool TryParseMechanicalBomAnnotationKey(
            string key,
            out int itemNumber,
            out string xuhaoHandle)
        {
            itemNumber = 0;
            xuhaoHandle = "";
            if (string.IsNullOrWhiteSpace(key))
            {
                return false;
            }

            int separator = key.IndexOf('#');
            if (separator <= 0
                || separator >= key.Length - 1
                || key.IndexOf('#', separator + 1) >= 0)
            {
                return false;
            }

            ulong decimalHandle;
            if (!int.TryParse(
                    key.Substring(0, separator),
                    NumberStyles.None,
                    CultureInfo.InvariantCulture,
                    out itemNumber)
                || itemNumber <= 0
                || !ulong.TryParse(
                    key.Substring(separator + 1),
                    NumberStyles.None,
                    CultureInfo.InvariantCulture,
                    out decimalHandle))
            {
                itemNumber = 0;
                return false;
            }

            xuhaoHandle = decimalHandle.ToString("X", CultureInfo.InvariantCulture);
            return true;
        }

        static double NumberValue(
            Dictionary<string, object> values,
            string key,
            double fallback)
        {
            if (values == null || !values.ContainsKey(key) || values[key] == null)
            {
                return fallback;
            }
            try
            {
                return Convert.ToDouble(values[key], CultureInfo.InvariantCulture);
            }
            catch
            {
                return fallback;
            }
        }

        static bool AnyNaN(params double[] values)
        {
            foreach (double value in values)
            {
                if (double.IsNaN(value))
                {
                    return true;
                }
            }
            return false;
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
                    if (name == "Database"
                        || name == "Document"
                        || name == "UndoFiler"
                        || name == "Drawable"
                        || string.Equals(name, "Hyperlinks", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }
                    // Some inherited getters (notably Hyperlinks) allocate a native
                    // DisposableWrapper. Retaining it until after a side database is
                    // disposed can crash THCAD's finalizer thread in TD_DbCore. The
                    // generic property bag is optional evidence, so never invoke
                    // getters whose declared type owns unmanaged state.
                    if (typeof(Teigha.Runtime.DisposableWrapper).IsAssignableFrom(
                            info.PropertyType)
                        || typeof(IDisposable).IsAssignableFrom(info.PropertyType)
                        || typeof(DBObject).IsAssignableFrom(info.PropertyType))
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

                        // A vendor property can expose a broad declared type (for
                        // example object) while returning a native wrapper at run
                        // time. DBObjects belong to the surrounding transaction and
                        // must not be disposed here; other wrappers are temporary
                        // reflection results and are released immediately.
                        if (value is DBObject)
                        {
                            continue;
                        }
                        var disposableValue = value as IDisposable;
                        if (disposableValue != null)
                        {
                            disposableValue.Dispose();
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
                    "is_by_color", Safe(() => c.IsByColor),
                    "method", Safe(() => c.ColorMethod.ToString()),
                    "red", Safe(() => (int)c.Red),
                    "green", Safe(() => (int)c.Green),
                    "blue", Safe(() => (int)c.Blue),
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
