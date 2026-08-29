using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Shb.Cad.Core
{
    /// <summary>
    /// Projects the authored and derived evidence produced by 04/05/08/11/13/16/17/18
    /// into one bounded, read-only cross-snapshot contract.  This class does not reopen
    /// a DWG and does not infer revision intent.
    /// </summary>
    public static class SemanticDrawingSnapshotBuilder
    {
        public static SemanticDrawingSnapshotDocument Create(
            string drawingId,
            string sourcePath,
            IEnumerable<Dictionary<string, object>> titleBlocks,
            MechanicalBomKnowledgeDocument bom,
            TechnicalRequirementsDocument technicalRequirements,
            AnnotationIdentificationDocument annotations,
            BlockInstanceCoordinateDocument instances,
            EngineeringViewRegionDocument regions,
            ManufacturingProfileFeatureDocument manufacturing,
            MechanicalInterfaceAdjacencyDocument interfaces,
            DimensionGeometryBindingDocument dimensions,
            SemanticDrawingSnapshotConfig config)
        {
            SemanticDrawingIdentityObservation identity = IdentityOf(
                drawingId, sourcePath, titleBlocks);
            return Create(
                identity,
                titleBlocks,
                bom,
                technicalRequirements,
                annotations,
                instances,
                regions,
                manufacturing,
                interfaces,
                dimensions,
                config);
        }

        public static SemanticDrawingSnapshotDocument Create(
            SemanticDrawingIdentityObservation identity,
            BlockInstanceCoordinateDocument instances,
            EngineeringViewRegionDocument regions,
            ManufacturingProfileFeatureDocument manufacturing,
            MechanicalInterfaceAdjacencyDocument interfaces,
            DimensionGeometryBindingDocument dimensions,
            SemanticDrawingSnapshotConfig config)
        {
            return Create(
                identity,
                null,
                null,
                null,
                null,
                instances,
                regions,
                manufacturing,
                interfaces,
                dimensions,
                config);
        }

        static SemanticDrawingSnapshotDocument Create(
            SemanticDrawingIdentityObservation identity,
            IEnumerable<Dictionary<string, object>> titleBlocks,
            MechanicalBomKnowledgeDocument bom,
            TechnicalRequirementsDocument technicalRequirements,
            AnnotationIdentificationDocument annotations,
            BlockInstanceCoordinateDocument instances,
            EngineeringViewRegionDocument regions,
            ManufacturingProfileFeatureDocument manufacturing,
            MechanicalInterfaceAdjacencyDocument interfaces,
            DimensionGeometryBindingDocument dimensions,
            SemanticDrawingSnapshotConfig config)
        {
            identity = identity ?? new SemanticDrawingIdentityObservation("");
            config = config ?? new SemanticDrawingSnapshotConfig();
            string sourceStatus = WorstStatus(new[]
            {
                DiagnosticStatus(instances == null ? null : instances.Diagnostics.Select(value => value.Status)),
                regions == null ? "computed" : regions.Status,
                manufacturing == null ? "computed" : manufacturing.Status,
                interfaces == null ? "computed" : interfaces.Status,
                dimensions == null ? "computed" : dimensions.Status
            });
            string snapshotId = "semantic-snapshot:" + SemanticDrawingDiffMaps.Hash(new[]
            {
                identity.DrawingKey,
                identity.Revision ?? "",
                identity.Stage ?? "",
                identity.SourcePath ?? "",
                identity.SourceFingerprint ?? ""
            });
            var document = new SemanticDrawingSnapshotDocument(
                snapshotId, identity, sourceStatus);

            ProjectTitleBlocks(document, titleBlocks, config);
            ProjectBom(document, bom, config);
            ProjectTechnicalRequirements(document, technicalRequirements, config);
            ProjectAnnotations(document, annotations, config);
            ProjectGeometryOccurrences(document, instances, config);
            ProjectRegions(document, regions, config);
            ProjectManufacturing(document, manufacturing, config);
            ProjectInterfaces(document, interfaces, manufacturing, config);
            ProjectDimensions(document, dimensions, config);
            ProjectDiagnostics(document, instances, regions, manufacturing, interfaces, dimensions);
            document.SetSnapshotId(ContentSnapshotId(document));
            return document;
        }

        public static SemanticDrawingIdentityObservation IdentityOf(
            string drawingId,
            string sourcePath,
            IEnumerable<Dictionary<string, object>> titleBlocks)
        {
            var identity = new SemanticDrawingIdentityObservation(drawingId ?? "")
                .SetSource(sourcePath ?? "", "");
            List<Dictionary<string, object>> blocks = titleBlocks == null
                ? new List<Dictionary<string, object>>()
                : titleBlocks.Where(value => value != null).ToList();
            Dictionary<string, object> best = blocks
                .OrderByDescending(value => NonEmptyFieldCount(FieldsOf(value)))
                .FirstOrDefault();
            IDictionary<string, object> fields = FieldsOf(best);
            string handle = StringOf(best, "handle");
            string source = string.IsNullOrEmpty(handle)
                ? "title_block_fields"
                : "title_block:" + handle;
            string drawingNumber = FirstField(fields,
                "图样代号", "图号", "DRAWINGNUMBER", "DRAWINGNO", "DWGNO");
            if (!string.IsNullOrEmpty(drawingNumber))
            {
                identity.SetDrawingNumber(drawingNumber, source + ".图样代号");
            }
            string drawingName = FirstField(fields,
                "图样名称", "图名", "DRAWINGNAME", "TITLE");
            if (!string.IsNullOrEmpty(drawingName))
            {
                identity.SetDrawingName(drawingName, source + ".图样名称");
            }
            string productModel = FirstField(fields,
                "产品型号", "型号", "PRODUCTMODEL", "MODEL");
            if (!string.IsNullOrEmpty(productModel))
            {
                identity.SetProductModel(productModel, source + ".产品型号");
            }
            string sheet = FirstField(fields, "第几页", "页码", "SHEET");
            string sheetCount = FirstField(fields, "共几页", "总页数", "SHEETCOUNT");
            if (!string.IsNullOrEmpty(sheet) || !string.IsNullOrEmpty(sheetCount))
            {
                identity.SetSheet(sheet, sheetCount, source + ".页码");
            }
            string revision = LatestRevisionField(fields);
            if (!string.IsNullOrEmpty(revision))
            {
                identity.SetRevision(revision, source + ".改版标记");
            }
            string stage = FirstField(fields,
                "设计阶段", "阶段", "阶段标记", "DESIGNSTAGE", "STAGE");
            if (!string.IsNullOrEmpty(stage))
            {
                identity.SetStage(stage, source + ".设计阶段");
            }
            identity.AddEvidence("title_block_count", blocks.Count.ToString(CultureInfo.InvariantCulture));
            return identity;
        }

        static void ProjectTitleBlocks(
            SemanticDrawingSnapshotDocument document,
            IEnumerable<Dictionary<string, object>> titleBlocks,
            SemanticDrawingSnapshotConfig config)
        {
            if (titleBlocks == null) { return; }
            foreach (Dictionary<string, object> block in titleBlocks.Where(value => value != null))
            {
                string handle = StringOf(block, "handle");
                IDictionary<string, object> fields = FieldsOf(block);
                string stable = string.IsNullOrEmpty(handle)
                    ? "title:" + SemanticDrawingDiffMaps.Hash(fields.OrderBy(value => value.Key)
                        .Select(value => value.Key))
                    : "title-handle:" + handle.ToUpperInvariant();
                var element = new SemanticDrawingElementObservation(
                    ElementId("drawing_metadata", stable),
                    "drawing_metadata",
                    "title_block",
                    stable,
                    "title_block");
                foreach (KeyValuePair<string, object> field in fields.OrderBy(value => value.Key))
                {
                    element.AddSemanticValue("field:" + field.Key, Convert.ToString(
                        field.Value, CultureInfo.InvariantCulture) ?? "");
                }
                if (!string.IsNullOrEmpty(handle)) { element.AddSourceHandle(handle); }
                SetBoundsFromMap(element, block.ContainsKey("bbox") ? block["bbox"] : null);
                if (!document.AddElement(element, config.MaximumElementCount)) { return; }
            }
        }

        static void ProjectBom(
            SemanticDrawingSnapshotDocument document,
            MechanicalBomKnowledgeDocument bom,
            SemanticDrawingSnapshotConfig config)
        {
            if (bom == null) { return; }
            foreach (MechanicalBomTableKnowledge table in bom.Tables)
            {
                foreach (MechanicalBomRowKnowledge row in table.Rows)
                {
                    string stable = row.ItemNumber.HasValue
                        ? table.Id + "|item:" + row.ItemNumber.Value.ToString(CultureInfo.InvariantCulture)
                        : row.Id;
                    var element = new SemanticDrawingElementObservation(
                        ElementId("bom_row", stable),
                        "bom_row",
                        "mechanical_bom_row",
                        stable,
                        "mechanical_bom_row");
                    if (row.ItemNumber.HasValue)
                    {
                        element.AddSemanticNumber("item_number", row.ItemNumber.Value);
                    }
                    foreach (KeyValuePair<string, string> value in row.Values)
                    {
                        element.AddSemanticValue(value.Key, value.Value);
                    }
                    foreach (KeyValuePair<string, string> value in row.CellHandles)
                    {
                        element.AddAssociation("cell:" + value.Key, value.Value)
                            .AddSourceHandle(value.Value);
                    }
                    foreach (MechanicalBomAnnotationObservation annotation in row.Annotations)
                    {
                        element.AddAssociation(
                            "item_annotation_handle", annotation.XuhaoHandle)
                            .AddSourceHandle(annotation.XuhaoHandle);
                        if (annotation.PointingPosition != null
                            && annotation.PointingPosition.Length >= 2)
                        {
                            element.AddAssociation(
                                "item_annotation_point_world",
                                RawPointToken(
                                    annotation.PointingPosition[0],
                                    annotation.PointingPosition[1]));
                        }
                        if (annotation.NumberPosition != null
                            && annotation.NumberPosition.Length >= 2)
                        {
                            element.AddAssociation(
                                "item_annotation_number_point_world",
                                RawPointToken(
                                    annotation.NumberPosition[0],
                                    annotation.NumberPosition[1]));
                        }
                    }
                    if (row.Source != null)
                    {
                        element.SetBounds(
                            row.Source.MinX, row.Source.MinY,
                            row.Source.MaxX, row.Source.MaxY)
                            .AddSourceHandle(row.Source.Handle);
                    }
                    element.AddSourceId(row.Id).AddRelationKey("bom_table:" + table.Id);
                    if (!document.AddElement(element, config.MaximumElementCount)) { return; }
                }
                foreach (int gap in table.SequenceGaps)
                {
                    document.AddIssue(new SemanticDrawingIssueObservation(
                        "bom-sequence-gap:" + table.Id + ":" + gap.ToString(CultureInfo.InvariantCulture),
                        "bom_sequence_gap_candidate",
                        "open",
                        "review",
                        "BOM item number is absent from the authored sequence.")
                        .AddSourceId(table.Id));
                }
                foreach (int duplicate in table.DuplicateItemNumbers)
                {
                    document.AddIssue(new SemanticDrawingIssueObservation(
                        "bom-duplicate-item:" + table.Id + ":" + duplicate.ToString(CultureInfo.InvariantCulture),
                        "bom_duplicate_item_candidate",
                        "open",
                        "review",
                        "BOM item number occurs more than once.")
                        .AddSourceId(table.Id));
                }
            }
        }

        static void ProjectTechnicalRequirements(
            SemanticDrawingSnapshotDocument document,
            TechnicalRequirementsDocument technical,
            SemanticDrawingSnapshotConfig config)
        {
            if (technical == null) { return; }
            foreach (TechnicalRequirementsSection section in technical.Sections)
            {
                foreach (TechnicalRequirementItem item in section.Items)
                {
                    string stable = section.Id + "|item:" + item.Number.ToString(CultureInfo.InvariantCulture);
                    var element = new SemanticDrawingElementObservation(
                        ElementId("technical_requirement", stable),
                        "technical_requirement",
                        "numbered_requirement",
                        stable,
                        "numbered_requirement|" + item.Number.ToString(CultureInfo.InvariantCulture))
                        .AddSemanticNumber("number", item.Number)
                        .AddSemanticValue("content", NormalizeText(item.Content))
                        .SetBounds(item.MinX, item.MinY, item.MaxX, item.MaxY)
                        .AddSourceId(section.Id);
                    foreach (string handle in item.SourceHandles) { element.AddSourceHandle(handle); }
                    if (!document.AddElement(element, config.MaximumElementCount)) { return; }
                }
                AddNumberingIssues(
                    document,
                    "technical-requirement",
                    section.Id,
                    section.MissingNumbers,
                    section.DuplicateNumbers);
            }
        }

        static void ProjectAnnotations(
            SemanticDrawingSnapshotDocument document,
            AnnotationIdentificationDocument annotations,
            SemanticDrawingSnapshotConfig config)
        {
            if (annotations == null) { return; }
            foreach (AnnotationRecord annotation in annotations.Annotations)
            {
                string sourceKey = JoinStable(annotation.SourceHandles);
                string stable = string.IsNullOrEmpty(sourceKey) ? annotation.Id : sourceKey;
                string match = string.Join("|", new[]
                {
                    annotation.Type ?? "",
                    annotation.Subtype ?? "",
                    annotation.OwnerScope ?? "",
                    annotation.RuntimeClass ?? ""
                });
                var element = new SemanticDrawingElementObservation(
                    ElementId("annotation", stable),
                    "annotation",
                    annotation.Type,
                    stable,
                    match)
                    .AddSemanticValue("subtype", annotation.Subtype)
                    .AddSemanticValue("display_text", NormalizeText(annotation.DisplayText))
                    .AddSemanticValue("semantic_status", annotation.SemanticStatus)
                    .AddSemanticValue("meaning_status", annotation.MeaningStatus)
                    .AddSemanticValue("removal_scope", annotation.RemovalScope)
                    .AddStyleValue("layer", annotation.Layer)
                    .AddStyleValue("dimension_style", annotation.DimensionStyle)
                    .SetEvidenceStatus(annotation.SemanticStatus)
                    .AddSourceId(annotation.Id);
                if (annotation.HasMeasurement)
                {
                    element.AddSemanticNumber("measurement", annotation.Measurement);
                }
                element.AddSemanticNumber("direction_x", annotation.DirectionX)
                    .AddSemanticNumber("direction_y", annotation.DirectionY);
                if (annotation.HasBounds)
                {
                    element.SetBounds(
                        annotation.MinX, annotation.MinY,
                        annotation.MaxX, annotation.MaxY);
                }
                foreach (string handle in annotation.SourceHandles) { element.AddSourceHandle(handle); }
                foreach (AnnotationPointObservation point in annotation.GeometryPoints)
                {
                    element.AddAssociation(
                        "geometry_point_role", point.Role + ":" + PointToken(point.X, point.Y, config));
                }
                element.SetGeometrySignature(PathSignature(
                    annotation.GeometryPoints.Select(value => new[] { value.X, value.Y }),
                    config.SignatureCoordinateTolerance));
                if (!document.AddElement(element, config.MaximumElementCount)) { return; }
            }
        }

        static void ProjectGeometryOccurrences(
            SemanticDrawingSnapshotDocument document,
            BlockInstanceCoordinateDocument instances,
            SemanticDrawingSnapshotConfig config)
        {
            if (instances == null) { return; }
            int projected = 0;
            foreach (InstanceOccurrenceRecord occurrence in instances.Occurrences.Where(value =>
                value != null && value.HasWorldPath && value.Visible))
            {
                if (projected >= Math.Max(1, config.MaximumGeometryOccurrenceCount))
                {
                    document.MarkTruncated(
                        "SNAPSHOT_GEOMETRY_OCCURRENCE_LIMIT_REACHED",
                        occurrence.Id,
                        "Visible curve occurrence projection was truncated; absence beyond the limit is unknown.");
                    return;
                }
                string stable = occurrence.Id;
                string geometrySignature = PathSignature(
                    occurrence.WorldPath.Select(value => new[] { value.X, value.Y }),
                    config.SignatureCoordinateTolerance);
                string match = string.Join("|", new[]
                {
                    occurrence.GeometryKind ?? "",
                    occurrence.IsClosed ? "closed" : "open",
                    occurrence.SemanticRole ?? ""
                });
                var element = new SemanticDrawingElementObservation(
                    ElementId("geometry_occurrence", stable),
                    "geometry_occurrence",
                    occurrence.GeometryKind,
                    stable,
                    match)
                    .SetGeometrySignature(geometrySignature)
                    .SetEvidenceStatus(occurrence.Status)
                    .AddSemanticValue("semantic_role", occurrence.SemanticRole)
                    .AddSemanticValue("geometry_quality", occurrence.GeometryQuality)
                    .AddSemanticValue("source_definition_name", occurrence.SourceDefinitionName)
                    .AddSemanticNumber("nesting_depth", occurrence.NestingDepth)
                    .AddGeometryMetric("path_length", PathLength(
                        occurrence.WorldPath.Select(value => new[] { value.X, value.Y })))
                    .AddGeometryMetric("point_count", occurrence.WorldPath.Count)
                    .AddGeometryMetric("closed", occurrence.IsClosed ? 1 : 0)
                    .AddSourceId(occurrence.Id)
                    .AddSourceHandle(occurrence.SourceHandle)
                    .AddRelationKey("occurrence:" + occurrence.Id);
                if (occurrence.HasBounds)
                {
                    element.SetBounds(
                        occurrence.MinX, occurrence.MinY,
                        occurrence.MaxX, occurrence.MaxY)
                        .AddGeometryMetric("width", occurrence.MaxX - occurrence.MinX)
                        .AddGeometryMetric("height", occurrence.MaxY - occurrence.MinY);
                }
                AddEffectiveStyle(element, occurrence.EffectiveStyle);
                foreach (string path in occurrence.InstancePath)
                {
                    element.AddAssociation("instance_path", path);
                }
                if (!document.AddElement(element, config.MaximumElementCount)) { return; }
                projected++;
            }
        }

        static void ProjectRegions(
            SemanticDrawingSnapshotDocument document,
            EngineeringViewRegionDocument regions,
            SemanticDrawingSnapshotConfig config)
        {
            if (regions == null) { return; }
            foreach (EngineeringViewRegionRecord region in regions.Regions)
            {
                string stable = region.Id;
                string match = string.Join("|", new[]
                {
                    region.Kind ?? "",
                    region.Subtype ?? ""
                });
                var element = new SemanticDrawingElementObservation(
                    ElementId("engineering_region", stable),
                    "engineering_region",
                    region.Kind,
                    stable,
                    match)
                    .SetBounds(region.MinX, region.MinY, region.MaxX, region.MaxY)
                    .SetEvidenceStatus(region.Status)
                    .SetGeometrySignature(SemanticDrawingDiffMaps.Hash(new[]
                    {
                        region.Kind,
                        region.Subtype,
                        Quantized(region.Width, config.SignatureCoordinateTolerance),
                        Quantized(region.Height, config.SignatureCoordinateTolerance),
                        region.FaceCount.ToString(CultureInfo.InvariantCulture)
                    }))
                    .AddSemanticValue("subtype", region.Subtype)
                    .AddSemanticValue("label_texts", string.Join("\n", region.LabelTexts.Select(NormalizeText)))
                    .AddGeometryMetric("width", region.Width)
                    .AddGeometryMetric("height", region.Height)
                    .AddGeometryMetric("area", region.Area)
                    .AddGeometryMetric("topology_length", region.TopologyLength)
                    .AddGeometryMetric("face_count", region.FaceCount)
                    .AddSourceId(region.Id);
                if (region.LocalFrame != null)
                {
                    element.AddGeometryMetric("local_frame_origin_x", region.LocalFrame.OriginX)
                        .AddGeometryMetric("local_frame_origin_y", region.LocalFrame.OriginY)
                        .AddGeometryMetric("local_frame_axis_x_x", region.LocalFrame.AxisXx)
                        .AddGeometryMetric("local_frame_axis_x_y", region.LocalFrame.AxisXy)
                        .AddGeometryMetric("local_frame_axis_y_x", region.LocalFrame.AxisYx)
                        .AddGeometryMetric("local_frame_axis_y_y", region.LocalFrame.AxisYy)
                        .AddGeometryMetric("local_frame_scale", region.LocalFrame.Scale)
                        .AddGeometryMetric(
                            "local_frame_orthogonal_coverage",
                            region.LocalFrame.OrthogonalCoverage)
                        .AddSemanticValue(
                            "local_frame_scale_source",
                            region.LocalFrame.ScaleSource);
                }
                foreach (string value in region.ComponentIds) { element.AddAssociation("component_id", value); }
                foreach (string value in region.OccurrenceIds) { element.AddAssociation("occurrence_id", value); }
                foreach (string value in region.KnownDocumentRegionIds)
                {
                    element.AddAssociation("known_document_region_id", value);
                }
                if (!document.AddElement(element, config.MaximumElementCount)) { return; }
            }
        }

        static void ProjectManufacturing(
            SemanticDrawingSnapshotDocument document,
            ManufacturingProfileFeatureDocument manufacturing,
            SemanticDrawingSnapshotConfig config)
        {
            if (manufacturing == null) { return; }
            int projected = 0;
            foreach (ManufacturingProfileRecord profile in manufacturing.Profiles)
            {
                if (projected >= Math.Max(1, config.MaximumProfileCount))
                {
                    document.MarkTruncated(
                        "SNAPSHOT_MANUFACTURING_PROFILE_LIMIT_REACHED",
                        profile.Id,
                        "Manufacturing profile projection was truncated; absence beyond the limit is unknown.");
                    return;
                }
                string match = string.Join("|", new[]
                {
                    profile.ProfileRole ?? "",
                    profile.ShapeClass ?? "",
                    profile.EffectiveCornerCount.ToString(CultureInfo.InvariantCulture)
                });
                var element = new SemanticDrawingElementObservation(
                    ElementId("manufacturing_profile", profile.Id),
                    "manufacturing_profile",
                    profile.ProfileRole,
                    profile.Id,
                    match)
                    .SetBounds(profile.MinX, profile.MinY, profile.MaxX, profile.MaxY)
                    .SetEvidenceStatus(profile.Status)
                    .SetGeometrySignature(ProfileSignature(
                        profile.ShapeClass,
                        profile.OrientedWidth,
                        profile.OrientedHeight,
                        profile.OrientationDegrees,
                        profile.NetArea,
                        profile.Perimeter,
                        profile.EffectiveCornerCount,
                        config))
                    .AddSemanticValue("shape_class", profile.ShapeClass)
                    .AddSemanticValue("boundary_quality", profile.BoundaryQuality)
                    .AddGeometryMetric("oriented_width", profile.OrientedWidth)
                    .AddGeometryMetric("oriented_height", profile.OrientedHeight)
                    .AddGeometryMetric("orientation_degrees", profile.OrientationDegrees)
                    .AddGeometryMetric("gross_area", profile.GrossArea)
                    .AddGeometryMetric("net_area", profile.NetArea)
                    .AddGeometryMetric("perimeter", profile.Perimeter)
                    .AddGeometryMetric("circularity", profile.Circularity)
                    .AddGeometryMetric("rectangularity", profile.Rectangularity)
                    .AddGeometryMetric("aspect_ratio", profile.AspectRatio)
                    .AddGeometryMetric("radial_variation", profile.RadialVariation)
                    .AddGeometryMetric("effective_corner_count", profile.EffectiveCornerCount)
                    .AddSourceId(profile.Id)
                    .AddAssociation("region_id", profile.RegionId)
                    .AddAssociation("physical_object_cluster_id", profile.PhysicalObjectClusterId)
                    .AddRelationKey("region:" + profile.RegionId)
                    .AddRelationKey("physical_object_cluster:" + profile.PhysicalObjectClusterId);
                foreach (string handle in profile.SourceHandles) { element.AddSourceHandle(handle); }
                foreach (string occurrence in profile.SourceOccurrenceIds)
                {
                    element.AddAssociation("source_occurrence_id", occurrence);
                }
                foreach (string parent in profile.ParentProfileIds)
                {
                    element.AddAssociation("parent_profile_id", parent);
                }
                foreach (string voidId in profile.VoidBoundaryIds)
                {
                    element.AddAssociation("void_boundary_id", voidId);
                }
                if (!document.AddElement(element, config.MaximumElementCount)) { return; }
                projected++;
            }
            foreach (ManufacturingVoidBoundaryRecord boundary in manufacturing.VoidBoundaries)
            {
                if (projected >= Math.Max(1, config.MaximumProfileCount))
                {
                    document.MarkTruncated(
                        "SNAPSHOT_MANUFACTURING_PROFILE_LIMIT_REACHED",
                        boundary.Id,
                        "Manufacturing profile and void projection was truncated; absence beyond the limit is unknown.");
                    return;
                }
                var element = new SemanticDrawingElementObservation(
                    ElementId("manufacturing_profile", boundary.Id),
                    "manufacturing_profile",
                    "void_boundary",
                    boundary.Id,
                    "void_boundary|" + boundary.ShapeClass)
                    .SetBounds(boundary.MinX, boundary.MinY, boundary.MaxX, boundary.MaxY)
                    .SetEvidenceStatus(boundary.Status)
                    .SetGeometrySignature(boundary.GeometrySignature)
                    .AddSemanticValue("shape_class", boundary.ShapeClass)
                    .AddGeometryMetric("oriented_width", boundary.OrientedWidth)
                    .AddGeometryMetric("oriented_height", boundary.OrientedHeight)
                    .AddGeometryMetric("orientation_degrees", boundary.OrientationDegrees)
                    .AddGeometryMetric("area", boundary.Area)
                    .AddGeometryMetric("perimeter", boundary.Perimeter)
                    .AddGeometryMetric("circularity", boundary.Circularity)
                    .AddGeometryMetric("rectangularity", boundary.Rectangularity)
                    .AddGeometryMetric("aspect_ratio", boundary.AspectRatio)
                    .AddGeometryMetric("radial_variation", boundary.RadialVariation)
                    .AddGeometryMetric("effective_corner_count", boundary.EffectiveCornerCount)
                    .AddAssociation("host_profile_id", boundary.HostProfileId)
                    .AddAssociation("boundary_profile_id", boundary.BoundaryProfileId)
                    .AddAssociation("region_id", boundary.RegionId)
                    .AddAssociation("physical_object_cluster_id", boundary.PhysicalObjectClusterId)
                    .AddSourceId(boundary.Id)
                    .AddRelationKey("region:" + boundary.RegionId)
                    .AddRelationKey("physical_object_cluster:" + boundary.PhysicalObjectClusterId);
                foreach (string handle in boundary.SourceHandles) { element.AddSourceHandle(handle); }
                foreach (string occurrence in boundary.SourceOccurrenceIds)
                {
                    element.AddAssociation("source_occurrence_id", occurrence);
                }
                if (!document.AddElement(element, config.MaximumElementCount)) { return; }
                projected++;
            }
        }

        static void ProjectInterfaces(
            SemanticDrawingSnapshotDocument document,
            MechanicalInterfaceAdjacencyDocument interfaces,
            ManufacturingProfileFeatureDocument manufacturing,
            SemanticDrawingSnapshotConfig config)
        {
            if (interfaces == null) { return; }
            int projected = 0;
            var featureById = interfaces.Features
                .GroupBy(value => value.Id, StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
            var profileById = manufacturing == null
                ? new Dictionary<string, ManufacturingProfileRecord>(StringComparer.Ordinal)
                : manufacturing.Profiles
                    .GroupBy(value => value.Id, StringComparer.Ordinal)
                    .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
            foreach (MechanicalInterfaceFeatureRecord feature in interfaces.Features)
            {
                if (!CanProjectInterface(document, feature.Id, ref projected, config)) { return; }
                double halfWidth = Math.Abs(feature.OrientedWidth) * 0.5;
                double halfHeight = Math.Abs(feature.OrientedHeight) * 0.5;
                var element = new SemanticDrawingElementObservation(
                    ElementId("interface_feature", feature.Id),
                    "interface_feature",
                    feature.FeatureKind,
                    feature.Id,
                    string.Join("|", new[]
                    {
                        feature.FeatureKind,
                        feature.ShapeClass
                    }))
                    .SetBounds(
                        feature.CenterX - halfWidth, feature.CenterY - halfHeight,
                        feature.CenterX + halfWidth, feature.CenterY + halfHeight)
                    .SetEvidenceStatus(feature.Status)
                    .SetGeometrySignature(ProfileSignature(
                        feature.ShapeClass,
                        feature.OrientedWidth,
                        feature.OrientedHeight,
                        feature.OrientationDegrees,
                        feature.Area,
                        0,
                        0,
                        config))
                    .AddSemanticValue("shape_class", feature.ShapeClass)
                    .AddGeometryMetric("oriented_width", feature.OrientedWidth)
                    .AddGeometryMetric("oriented_height", feature.OrientedHeight)
                    .AddGeometryMetric("orientation_degrees", feature.OrientationDegrees)
                    .AddGeometryMetric("area", feature.Area)
                    .AddAssociation("host_profile_id", feature.HostProfileId)
                    .AddAssociation("boundary_profile_id", feature.BoundaryProfileId)
                    .AddAssociation("region_id", feature.RegionId)
                    .AddAssociation("physical_object_cluster_id", feature.PhysicalObjectClusterId)
                    .AddSourceId(feature.Id)
                    .AddRelationKey("region:" + feature.RegionId)
                    .AddRelationKey("physical_object_cluster:" + feature.PhysicalObjectClusterId);
                foreach (string handle in feature.SourceHandles) { element.AddSourceHandle(handle); }
                foreach (string occurrence in feature.SourceOccurrenceIds)
                {
                    element.AddAssociation("source_occurrence_id", occurrence);
                }
                if (!document.AddElement(element, config.MaximumElementCount)) { return; }
            }
            foreach (MechanicalInterfacePatternRecord pattern in interfaces.Patterns)
            {
                if (!CanProjectInterface(document, pattern.Id, ref projected, config)) { return; }
                var element = new SemanticDrawingElementObservation(
                    ElementId("interface_pattern", pattern.Id),
                    "interface_pattern",
                    pattern.Kind,
                    pattern.Id,
                    pattern.Kind + "|" + pattern.FeatureIds.Count)
                    .SetEvidenceStatus(pattern.Status)
                    .SetGeometrySignature(SemanticDrawingDiffMaps.Hash(new[]
                    {
                        pattern.Kind,
                        pattern.Alignment,
                        string.Join(",", pattern.Spacings.Select(value => Quantized(
                            value, config.SignatureCoordinateTolerance)))
                    }))
                    .AddSemanticValue("evidence_grade", pattern.EvidenceGrade)
                    .AddSemanticValue("alignment", pattern.Alignment)
                    .AddSemanticValue(
                        "spacings",
                        string.Join(",", pattern.Spacings.Select(value =>
                            value.ToString("G17", CultureInfo.InvariantCulture))))
                    .AddGeometryMetric("feature_count", pattern.FeatureIds.Count)
                    .AddGeometryMetric("spacing_count", pattern.Spacings.Count)
                    .AddSourceId(pattern.Id)
                    .AddAssociation("region_id", pattern.RegionId)
                    .AddAssociation("physical_object_cluster_id", pattern.PhysicalObjectClusterId)
                    .AddRelationKey("region:" + pattern.RegionId)
                    .AddRelationKey("physical_object_cluster:" + pattern.PhysicalObjectClusterId);
                foreach (string id in pattern.FeatureIds) { element.AddAssociation("feature_id", id); }
                foreach (string id in pattern.ProfileIds) { element.AddAssociation("profile_id", id); }
                AddNullableMetric(element, "center_residual", pattern.CenterResidual);
                AddNullableMetric(element, "clearance", pattern.Clearance);
                AddNullableMetric(element, "size_ratio", pattern.SizeRatio);
                AddNullableMetric(element, "angular_residual_degrees", pattern.AngularResidualDegrees);
                if (pattern.Spacings.Count > 0)
                {
                    element.AddGeometryMetric("spacing_minimum", pattern.Spacings.Min())
                        .AddGeometryMetric("spacing_maximum", pattern.Spacings.Max());
                }
                SetBoundsFromLinkedFeatures(element, pattern.FeatureIds, featureById);
                if (element.HasBounds)
                {
                    element.AddGeometryMetric("envelope_width", element.MaxX - element.MinX)
                        .AddGeometryMetric("envelope_height", element.MaxY - element.MinY);
                }
                if (!document.AddElement(element, config.MaximumElementCount)) { return; }
            }
            foreach (MechanicalAdjacencyEvidenceRecord adjacency in interfaces.Adjacencies)
            {
                if (!CanProjectInterface(document, adjacency.Id, ref projected, config)) { return; }
                var element = new SemanticDrawingElementObservation(
                    ElementId("interface_adjacency", adjacency.Id),
                    "interface_adjacency",
                    adjacency.Kind,
                    adjacency.Id,
                    adjacency.Kind)
                    .SetEvidenceStatus(adjacency.Status)
                    .AddSemanticValue("evidence_grade", adjacency.EvidenceGrade)
                    .AddAssociation("left_profile_id", adjacency.LeftProfileId)
                    .AddAssociation("right_profile_id", adjacency.RightProfileId)
                    .AddAssociation("open_boundary_id", adjacency.OpenBoundaryId)
                    .AddAssociation("endpoint_vertex_id", adjacency.EndpointVertexId)
                    .AddAssociation("region_id", adjacency.RegionId)
                    .AddAssociation("physical_object_cluster_id", adjacency.PhysicalObjectClusterId)
                    .AddSourceId(adjacency.Id)
                    .AddRelationKey("region:" + adjacency.RegionId)
                    .AddRelationKey("physical_object_cluster:" + adjacency.PhysicalObjectClusterId);
                AddNullableMetric(element, "shared_length", adjacency.SharedLength);
                AddNullableMetric(element, "gap", adjacency.Gap);
                AddNullableMetric(element, "tolerance", adjacency.Tolerance);
                foreach (string handle in adjacency.SourceHandles) { element.AddSourceHandle(handle); }
                SetBoundsFromLinkedProfiles(
                    element,
                    new[] { adjacency.LeftProfileId, adjacency.RightProfileId },
                    profileById);
                if (!document.AddElement(element, config.MaximumElementCount)) { return; }
            }
        }

        static void ProjectDimensions(
            SemanticDrawingSnapshotDocument document,
            DimensionGeometryBindingDocument dimensions,
            SemanticDrawingSnapshotConfig config)
        {
            if (dimensions == null) { return; }
            foreach (DimensionGeometryBindingRecord binding in dimensions.Bindings)
            {
                string stable = string.Join("|", new[]
                {
                    binding.DimensionHandle == null ? "" : binding.DimensionHandle.ToUpperInvariant(),
                    binding.OccurrenceId ?? "",
                    binding.DimensionEdgeId ?? ""
                });
                var element = new SemanticDrawingElementObservation(
                    ElementId("dimension_binding", stable),
                    "dimension_binding",
                    binding.DimensionType,
                    stable,
                    string.Join("|", new[]
                    {
                        binding.DimensionType,
                        binding.OwnerScope,
                        binding.OwnerBlockName
                    }))
                    .SetEvidenceStatus(binding.Status)
                    .AddSemanticValue("dimension_text", NormalizeText(binding.DimensionText))
                    .AddSemanticValue("status", binding.Status)
                    .AddSemanticValue("link_kind", binding.LinkKind)
                    .AddSemanticValue("reference_dimension_candidate",
                        binding.IsReferenceDimensionCandidate ? "true" : "false")
                    .AddStyleValue("layer", binding.Layer)
                    .AddStyleValue("dimension_style", binding.DimensionStyle)
                    .AddGeometryMetric("source_definition_span", binding.SourceDefinitionSpan)
                    .AddGeometryMetric("axis_x", binding.AxisX)
                    .AddGeometryMetric("axis_y", binding.AxisY)
                    .AddGeometryMetric("axis_scale", binding.AxisScale)
                    .AddSourceId(binding.Id)
                    .AddSourceHandle(binding.DimensionHandle)
                    .AddRelationKey("dimension_edge:" + binding.DimensionEdgeId);
                if (binding.HasEntityMeasurement)
                {
                    element.AddSemanticNumber("entity_measurement", binding.EntityMeasurement);
                }
                if (binding.HasAuthoredLinearMeasurementFactor)
                {
                    element.AddSemanticNumber(
                        "authored_linear_measurement_factor",
                        binding.AuthoredLinearMeasurementFactor);
                }
                AddNullableMetric(element, "world_definition_span", binding.WorldDefinitionSpan);
                DimensionGeometryComparisonRecord comparison = binding.Comparison;
                if (comparison != null)
                {
                    element.AddSemanticValue(
                        "primary_comparison_status", comparison.PrimaryComparisonStatus)
                        .AddSemanticValue(
                            "display_override_status", comparison.DisplayOverrideStatus)
                        .AddSemanticValue(
                            "displayed_value_comparison_status", comparison.DisplayedValueComparisonStatus)
                        .AddSemanticValue(
                            "scale_normalized_comparison_status",
                            binding.ScaleNormalizedComparisonStatus);
                    AddNullableSemantic(element, "effective_displayed_value", comparison.EffectiveDisplayedValue);
                    AddNullableMetric(element, "source_unit_geometry_span_minimum",
                        comparison.SourceUnitGeometrySpanMinimum);
                    AddNullableMetric(element, "source_unit_geometry_span_maximum",
                        comparison.SourceUnitGeometrySpanMaximum);
                    AddNullableMetric(element, "world_geometry_span_minimum",
                        comparison.WorldGeometrySpanMinimum);
                    AddNullableMetric(element, "world_geometry_span_maximum",
                        comparison.WorldGeometrySpanMaximum);
                }
                AddDimensionEndpoint(element, "xline1", binding.FirstEndpoint);
                AddDimensionEndpoint(element, "xline2", binding.SecondEndpoint);
                foreach (string value in binding.ChainIds) { element.AddAssociation("chain_id", value); }
                foreach (string value in binding.RegionIds) { element.AddAssociation("region_id", value); }
                foreach (string value in binding.ProfileIds) { element.AddAssociation("profile_id", value); }
                foreach (string value in binding.InterfaceFeatureIds)
                {
                    element.AddAssociation("interface_feature_id", value);
                }
                foreach (string value in binding.PhysicalObjectClusterIds)
                {
                    element.AddAssociation("physical_object_cluster_id", value);
                }
                if (!string.IsNullOrEmpty(binding.AssociationHandle))
                {
                    element.AddAssociation("authored_dimassoc_handle", binding.AssociationHandle)
                        .AddSourceHandle(binding.AssociationHandle);
                }
                element.SetGeometrySignature(SemanticDrawingDiffMaps.Hash(new[]
                {
                    Quantized(binding.AxisX, config.SignatureCoordinateTolerance),
                    Quantized(binding.AxisY, config.SignatureCoordinateTolerance),
                    binding.LinkKind,
                    binding.FirstEndpoint == null ? "" : binding.FirstEndpoint.Status,
                    binding.SecondEndpoint == null ? "" : binding.SecondEndpoint.Status
                }));
                if (!document.AddElement(element, config.MaximumElementCount)) { return; }

                if (comparison != null
                    && comparison.PrimaryComparisonStatus
                        == "outside_configured_numeric_tolerance_candidate"
                    && binding.ScaleNormalizedComparisonStatus
                        != "within_inferred_scale_numeric_tolerance_candidate")
                {
                    document.AddIssue(new SemanticDrawingIssueObservation(
                        "dimension-unexplained-residual:" + stable,
                        "dimension_geometry_numeric_residual_candidate",
                        "open",
                        "review",
                        "Dimension and bound geometry remain outside configured tolerance after known scale evidence.")
                        .AddSourceId(binding.Id));
                }
            }
        }

        static void ProjectDiagnostics(
            SemanticDrawingSnapshotDocument document,
            BlockInstanceCoordinateDocument instances,
            EngineeringViewRegionDocument regions,
            ManufacturingProfileFeatureDocument manufacturing,
            MechanicalInterfaceAdjacencyDocument interfaces,
            DimensionGeometryBindingDocument dimensions)
        {
            if (instances != null)
            {
                foreach (BlockInstanceDiagnosticRecord diagnostic in instances.Diagnostics)
                {
                    AddUpstreamDiagnostic(
                        document,
                        "11",
                        diagnostic.Code,
                        diagnostic.Status,
                        string.IsNullOrEmpty(diagnostic.OccurrenceId)
                            ? diagnostic.SourceHandle
                            : diagnostic.OccurrenceId,
                        diagnostic.Message);
                }
            }
            if (regions != null)
            {
                foreach (EngineeringViewRegionDiagnosticRecord diagnostic in regions.Diagnostics)
                {
                    AddUpstreamDiagnostic(document, "13", diagnostic.Code, diagnostic.Status,
                        diagnostic.SourceId, diagnostic.Message);
                }
            }
            if (manufacturing != null)
            {
                foreach (ManufacturingProfileDiagnosticRecord diagnostic in manufacturing.Diagnostics)
                {
                    AddUpstreamDiagnostic(document, "16", diagnostic.Code, diagnostic.Status,
                        diagnostic.SourceId, diagnostic.Message);
                }
            }
            if (interfaces != null)
            {
                foreach (MechanicalInterfaceAdjacencyDiagnosticRecord diagnostic in interfaces.Diagnostics)
                {
                    AddUpstreamDiagnostic(document, "17", diagnostic.Code, diagnostic.Status,
                        diagnostic.SourceId, diagnostic.Message);
                }
            }
            if (dimensions != null)
            {
                foreach (DimensionGeometryBindingDiagnosticRecord diagnostic in dimensions.Diagnostics)
                {
                    AddUpstreamDiagnostic(document, "18", diagnostic.Code, diagnostic.Status,
                        diagnostic.SourceId, diagnostic.Message);
                }
            }
        }

        static void AddUpstreamDiagnostic(
            SemanticDrawingSnapshotDocument document,
            string sourceAnalysis,
            string code,
            string status,
            string sourceId,
            string message)
        {
            string qualifiedCode = "UPSTREAM_" + sourceAnalysis + "_" + (code ?? "");
            document.AddDiagnostic(new SemanticDrawingSnapshotDiagnosticRecord(
                qualifiedCode,
                status,
                sourceId,
                message));
            if (status == "ambiguous" || status == "unsupported"
                || status == "unsupported_partial")
            {
                document.AddIssue(new SemanticDrawingIssueObservation(
                    "upstream-diagnostic:" + SemanticDrawingDiffMaps.Hash(new[]
                    {
                        sourceAnalysis, code ?? "", sourceId ?? ""
                    }),
                    "upstream_analysis_diagnostic",
                    "open",
                    status == "unsupported" || status == "unsupported_partial"
                        ? "unsupported"
                        : "review",
                    message)
                    .AddSourceId(sourceId));
            }
        }

        static void AddNumberingIssues(
            SemanticDrawingSnapshotDocument document,
            string prefix,
            string sourceId,
            IEnumerable<int> missing,
            IEnumerable<int> duplicates)
        {
            foreach (int value in missing ?? Enumerable.Empty<int>())
            {
                document.AddIssue(new SemanticDrawingIssueObservation(
                    prefix + "-sequence-gap:" + sourceId + ":"
                        + value.ToString(CultureInfo.InvariantCulture),
                    prefix + "_sequence_gap_candidate",
                    "open",
                    "review",
                    "Number is absent from the authored sequence.")
                    .AddSourceId(sourceId));
            }
            foreach (int value in duplicates ?? Enumerable.Empty<int>())
            {
                document.AddIssue(new SemanticDrawingIssueObservation(
                    prefix + "-duplicate-number:" + sourceId + ":"
                        + value.ToString(CultureInfo.InvariantCulture),
                    prefix + "_duplicate_number_candidate",
                    "open",
                    "review",
                    "Number occurs more than once in the authored sequence.")
                    .AddSourceId(sourceId));
            }
        }

        static bool CanProjectInterface(
            SemanticDrawingSnapshotDocument document,
            string sourceId,
            ref int projected,
            SemanticDrawingSnapshotConfig config)
        {
            if (projected >= Math.Max(1, config.MaximumInterfaceRecordCount))
            {
                document.MarkTruncated(
                    "SNAPSHOT_INTERFACE_RECORD_LIMIT_REACHED",
                    sourceId,
                    "Interface feature, pattern, and adjacency projection was truncated; absence beyond the limit is unknown.");
                return false;
            }
            projected++;
            return true;
        }

        static void AddDimensionEndpoint(
            SemanticDrawingElementObservation element,
            string role,
            DimensionEndpointBindingRecord endpoint)
        {
            if (endpoint == null) { return; }
            element.AddSemanticValue(role + "_status", endpoint.Status)
                .AddAssociation(role + "_source_point",
                    PointToken(endpoint.SourceX, endpoint.SourceY, null));
            ExpandBounds(element, endpoint.SourceX, endpoint.SourceY, endpoint.SourceX, endpoint.SourceY);
            foreach (DimensionGeometryAnchorCandidateRecord candidate in endpoint.Candidates)
            {
                element.AddAssociation(role + "_anchor_candidate", candidate.Id)
                    .AddAssociation(role + "_anchor_kind", candidate.TargetKind);
                foreach (string handle in candidate.SourceHandles) { element.AddSourceHandle(handle); }
            }
        }

        static void AddEffectiveStyle(
            SemanticDrawingElementObservation element,
            InstanceEffectiveStyleRecord style)
        {
            if (element == null || style == null) { return; }
            element.AddStyleValue("layer", style.Layer)
                .AddStyleValue("linetype", style.Linetype)
                .AddStyleValue("linetype_source", style.LinetypeSource)
                .AddStyleValue("color", ColorToken(style.Color))
                .AddStyleValue("color_source", style.ColorSource)
                .AddStyleValue("lineweight", style.HasLineweight
                    ? style.Lineweight.ToString(CultureInfo.InvariantCulture)
                    : "not_available")
                .AddStyleValue("lineweight_source", style.LineweightSource)
                .AddStyleValue("layer_suppressed", style.LayerSuppressed ? "true" : "false");
        }

        static string ColorToken(InstanceColorObservation color)
        {
            if (color == null) { return "not_available"; }
            if (color.HasRgb)
            {
                return "rgb:" + color.Red.ToString(CultureInfo.InvariantCulture) + ","
                    + color.Green.ToString(CultureInfo.InvariantCulture) + ","
                    + color.Blue.ToString(CultureInfo.InvariantCulture);
            }
            if (color.HasIndex)
            {
                return "aci:" + color.Index.ToString(CultureInfo.InvariantCulture);
            }
            return string.IsNullOrEmpty(color.Name) ? color.Mode : color.Name;
        }

        static void AddNullableMetric(
            SemanticDrawingElementObservation element,
            string key,
            double? value)
        {
            if (value.HasValue) { element.AddGeometryMetric(key, value.Value); }
        }

        static void AddNullableSemantic(
            SemanticDrawingElementObservation element,
            string key,
            double? value)
        {
            if (value.HasValue) { element.AddSemanticNumber(key, value.Value); }
        }

        static void SetBoundsFromLinkedFeatures(
            SemanticDrawingElementObservation element,
            IEnumerable<string> featureIds,
            IDictionary<string, MechanicalInterfaceFeatureRecord> features)
        {
            foreach (string id in featureIds ?? Enumerable.Empty<string>())
            {
                MechanicalInterfaceFeatureRecord feature;
                if (!features.TryGetValue(id, out feature)) { continue; }
                double halfWidth = Math.Abs(feature.OrientedWidth) * 0.5;
                double halfHeight = Math.Abs(feature.OrientedHeight) * 0.5;
                ExpandBounds(
                    element,
                    feature.CenterX - halfWidth,
                    feature.CenterY - halfHeight,
                    feature.CenterX + halfWidth,
                    feature.CenterY + halfHeight);
            }
        }

        static void SetBoundsFromLinkedProfiles(
            SemanticDrawingElementObservation element,
            IEnumerable<string> profileIds,
            IDictionary<string, ManufacturingProfileRecord> profiles)
        {
            foreach (string id in profileIds ?? Enumerable.Empty<string>())
            {
                ManufacturingProfileRecord profile;
                if (!profiles.TryGetValue(id, out profile)) { continue; }
                ExpandBounds(
                    element,
                    profile.MinX, profile.MinY,
                    profile.MaxX, profile.MaxY);
            }
        }

        static void ExpandBounds(
            SemanticDrawingElementObservation element,
            double minX,
            double minY,
            double maxX,
            double maxY)
        {
            if (element == null) { return; }
            if (!element.HasBounds)
            {
                element.SetBounds(minX, minY, maxX, maxY);
                return;
            }
            element.SetBounds(
                Math.Min(element.MinX, minX),
                Math.Min(element.MinY, minY),
                Math.Max(element.MaxX, maxX),
                Math.Max(element.MaxY, maxY));
        }

        static void SetBoundsFromMap(
            SemanticDrawingElementObservation element,
            object boundsValue)
        {
            IDictionary bounds = boundsValue as IDictionary;
            if (bounds == null) { return; }
            IList minimum = DictionaryValue(bounds, "min") as IList;
            IList maximum = DictionaryValue(bounds, "max") as IList;
            if (minimum == null || maximum == null
                || minimum.Count < 2 || maximum.Count < 2)
            {
                return;
            }
            double minX;
            double minY;
            double maxX;
            double maxY;
            if (TryDouble(minimum[0], out minX)
                && TryDouble(minimum[1], out minY)
                && TryDouble(maximum[0], out maxX)
                && TryDouble(maximum[1], out maxY))
            {
                element.SetBounds(minX, minY, maxX, maxY);
            }
        }

        static string ProfileSignature(
            string shape,
            double width,
            double height,
            double orientation,
            double area,
            double perimeter,
            int corners,
            SemanticDrawingSnapshotConfig config)
        {
            double tolerance = config == null ? 0.001 : config.SignatureCoordinateTolerance;
            return SemanticDrawingDiffMaps.Hash(new[]
            {
                shape ?? "",
                Quantized(width, tolerance),
                Quantized(height, tolerance),
                Quantized(orientation, 0.001),
                Quantized(area, tolerance * tolerance),
                Quantized(perimeter, tolerance),
                corners.ToString(CultureInfo.InvariantCulture)
            });
        }

        static string PathSignature(
            IEnumerable<double[]> points,
            double tolerance)
        {
            List<double[]> values = points == null
                ? new List<double[]>()
                : points.Where(value => value != null && value.Length >= 2
                    && IsFinite(value[0]) && IsFinite(value[1])).ToList();
            if (values.Count == 0) { return ""; }
            double centerX = values.Average(value => value[0]);
            double centerY = values.Average(value => value[1]);
            List<string> relativePoints = values.Select(value =>
                Quantized(value[0] - centerX, tolerance) + ","
                    + Quantized(value[1] - centerY, tolerance))
                .OrderBy(value => value, StringComparer.Ordinal).ToList();
            return SemanticDrawingDiffMaps.Hash(new[]
            {
                values.Count.ToString(CultureInfo.InvariantCulture),
                string.Join(";", relativePoints),
                Quantized(PathLength(values), tolerance)
            });
        }

        static double PathLength(IEnumerable<double[]> points)
        {
            double result = 0;
            double[] previous = null;
            foreach (double[] point in points ?? Enumerable.Empty<double[]>())
            {
                if (point == null || point.Length < 2) { continue; }
                if (previous != null)
                {
                    double dx = point[0] - previous[0];
                    double dy = point[1] - previous[1];
                    result += Math.Sqrt(dx * dx + dy * dy);
                }
                previous = point;
            }
            return result;
        }

        static string PointToken(
            double x,
            double y,
            SemanticDrawingSnapshotConfig config)
        {
            double tolerance = config == null ? 0.001 : config.SignatureCoordinateTolerance;
            return Quantized(x, tolerance) + "," + Quantized(y, tolerance);
        }

        static string RawPointToken(double x, double y)
        {
            return x.ToString("G17", CultureInfo.InvariantCulture)
                + ","
                + y.ToString("G17", CultureInfo.InvariantCulture);
        }

        static string Quantized(double value, double tolerance)
        {
            if (!IsFinite(value)) { return "nan"; }
            double quantum = Math.Max(Math.Abs(tolerance), 0.000000000001);
            return Math.Round(value / quantum, MidpointRounding.AwayFromZero)
                .ToString("0", CultureInfo.InvariantCulture);
        }

        static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }

        static string ElementId(string domain, string stable)
        {
            return "semantic-element:" + SemanticDrawingDiffMaps.Hash(new[]
            {
                domain ?? "", stable ?? ""
            });
        }

        static string ContentSnapshotId(SemanticDrawingSnapshotDocument document)
        {
            var values = new List<string>
            {
                document.Identity.DrawingKey,
                document.Identity.Revision ?? "",
                document.Identity.Stage ?? "",
                document.Identity.SourcePath ?? "",
                document.SourceStatus,
                document.Truncated ? "truncated" : "complete"
            };
            values.AddRange(document.Elements
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .Select(ElementFingerprint));
            values.AddRange(document.Issues
                .OrderBy(value => value.IssueKey, StringComparer.Ordinal)
                .Select(value => string.Join("\u001e", new[]
                {
                    value.IssueKey,
                    value.IssueType,
                    value.State,
                    value.Severity,
                    value.Message
                })));
            values.AddRange(document.Diagnostics
                .OrderBy(value => value.Code, StringComparer.Ordinal)
                .ThenBy(value => value.SourceId, StringComparer.Ordinal)
                .Select(value => string.Join("\u001e", new[]
                {
                    value.Code,
                    value.Status,
                    value.SourceId,
                    value.Message
                })));
            return "semantic-snapshot:" + SemanticDrawingDiffMaps.Hash(values);
        }

        static string ElementFingerprint(SemanticDrawingElementObservation element)
        {
            var values = new List<string>
            {
                element.Id,
                element.Domain,
                element.Kind,
                element.StableKey,
                element.MatchSignature,
                element.GeometrySignature,
                element.EvidenceStatus,
                element.HasBounds
                    ? string.Join(",", new[]
                    {
                        element.MinX.ToString("R", CultureInfo.InvariantCulture),
                        element.MinY.ToString("R", CultureInfo.InvariantCulture),
                        element.MaxX.ToString("R", CultureInfo.InvariantCulture),
                        element.MaxY.ToString("R", CultureInfo.InvariantCulture)
                    })
                    : "no-bounds"
            };
            values.AddRange(element.SemanticValues.OrderBy(value => value.Key, StringComparer.Ordinal)
                .Select(value => "sv:" + value.Key + "=" + value.Value));
            values.AddRange(element.SemanticNumbers.OrderBy(value => value.Key, StringComparer.Ordinal)
                .Select(value => "sn:" + value.Key + "="
                    + value.Value.ToString("R", CultureInfo.InvariantCulture)));
            values.AddRange(element.GeometryMetrics.OrderBy(value => value.Key, StringComparer.Ordinal)
                .Select(value => "gm:" + value.Key + "="
                    + value.Value.ToString("R", CultureInfo.InvariantCulture)));
            values.AddRange(element.StyleValues.OrderBy(value => value.Key, StringComparer.Ordinal)
                .Select(value => "st:" + value.Key + "=" + value.Value));
            foreach (KeyValuePair<string, IList<string>> association in element.Associations
                .OrderBy(value => value.Key, StringComparer.Ordinal))
            {
                values.Add("as:" + association.Key + "="
                    + string.Join(",", association.Value));
            }
            return SemanticDrawingDiffMaps.Hash(values);
        }

        static string JoinStable(IEnumerable<string> values)
        {
            return string.Join("|", (values ?? Enumerable.Empty<string>())
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Select(value => value.ToUpperInvariant())
                .Distinct(StringComparer.Ordinal)
                .OrderBy(value => value, StringComparer.Ordinal));
        }

        static string NormalizeText(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) { return ""; }
            return string.Join(" ", value.Replace("\r", " ").Replace("\n", " ")
                .Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries));
        }

        static IDictionary<string, object> FieldsOf(Dictionary<string, object> block)
        {
            if (block == null || !block.ContainsKey("fields"))
            {
                return new Dictionary<string, object>(StringComparer.Ordinal);
            }
            IDictionary<string, object> typed = block["fields"] as IDictionary<string, object>;
            if (typed != null) { return typed; }
            IDictionary values = block["fields"] as IDictionary;
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            if (values == null) { return result; }
            foreach (DictionaryEntry entry in values)
            {
                result[Convert.ToString(entry.Key, CultureInfo.InvariantCulture) ?? ""] = entry.Value;
            }
            return result;
        }

        static int NonEmptyFieldCount(IDictionary<string, object> fields)
        {
            return fields == null ? 0 : fields.Count(value =>
                !string.IsNullOrWhiteSpace(Convert.ToString(
                    value.Value, CultureInfo.InvariantCulture)));
        }

        static string FirstField(IDictionary<string, object> fields, params string[] candidates)
        {
            if (fields == null) { return ""; }
            var normalized = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (KeyValuePair<string, object> field in fields)
            {
                string key = NormalizeFieldKey(field.Key);
                string value = Convert.ToString(field.Value, CultureInfo.InvariantCulture) ?? "";
                string existing;
                if (!normalized.TryGetValue(key, out existing)
                    || (string.IsNullOrWhiteSpace(existing) && !string.IsNullOrWhiteSpace(value)))
                {
                    normalized[key] = value;
                }
            }
            foreach (string candidate in candidates ?? new string[0])
            {
                string value;
                if (normalized.TryGetValue(NormalizeFieldKey(candidate), out value)
                    && !string.IsNullOrWhiteSpace(value))
                {
                    return value.Trim();
                }
            }
            return "";
        }

        static string LatestRevisionField(IDictionary<string, object> fields)
        {
            string[] candidates =
            {
                "改版标记4", "改版标记3", "改版标记2", "改版标记1",
                "版次", "版本", "REVISION", "REV",
                "标记4", "标记3", "标记2", "标记1"
            };
            return FirstField(fields, candidates);
        }

        static string NormalizeFieldKey(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) { return ""; }
            return new string(value.Trim().ToUpperInvariant().Where(character =>
                !char.IsWhiteSpace(character)
                && character != '_'
                && character != '-'
                && character != '.'
                && character != ':').ToArray());
        }

        static string StringOf(Dictionary<string, object> map, string key)
        {
            if (map == null || !map.ContainsKey(key)) { return ""; }
            return Convert.ToString(map[key], CultureInfo.InvariantCulture) ?? "";
        }

        static object DictionaryValue(IDictionary dictionary, string key)
        {
            if (dictionary == null) { return null; }
            foreach (DictionaryEntry entry in dictionary)
            {
                if (string.Equals(Convert.ToString(entry.Key), key, StringComparison.Ordinal))
                {
                    return entry.Value;
                }
            }
            return null;
        }

        static bool TryDouble(object value, out double result)
        {
            try
            {
                result = Convert.ToDouble(value, CultureInfo.InvariantCulture);
                return IsFinite(result);
            }
            catch
            {
                result = 0;
                return false;
            }
        }

        static string DiagnosticStatus(IEnumerable<string> statuses)
        {
            return WorstStatus(statuses ?? Enumerable.Empty<string>());
        }

        static string WorstStatus(IEnumerable<string> statuses)
        {
            bool ambiguous = false;
            foreach (string status in statuses ?? Enumerable.Empty<string>())
            {
                if (status == "unsupported" || status == "unsupported_partial")
                {
                    return "unsupported_partial";
                }
                if (status == "ambiguous") { ambiguous = true; }
            }
            return ambiguous ? "ambiguous" : "computed";
        }
    }
}
