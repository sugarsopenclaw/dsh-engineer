using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace Shb.Cad.Core
{
    public sealed class BomInstanceCoverageConfig
    {
        public BomInstanceCoverageConfig()
        {
            MaximumInstanceDetails = 200;
            ExplicitAnchorDistanceTolerance = 0;
            AnchorDistanceDrawingDiagonalRatio = 0.02;
            AnchorDistanceMedianLeafSpanMultiplier = 3.0;
            MinimumAnchorDistanceTolerance = 0.001;
        }

        public int MaximumInstanceDetails { get; set; }
        public double ExplicitAnchorDistanceTolerance { get; set; }
        public double AnchorDistanceDrawingDiagonalRatio { get; set; }
        public double AnchorDistanceMedianLeafSpanMultiplier { get; set; }
        public double MinimumAnchorDistanceTolerance { get; set; }
    }

    public sealed class BomInstanceCoverageDiagnosticRecord
    {
        internal BomInstanceCoverageDiagnosticRecord(
            string code,
            string status,
            string segmentId,
            string sourceId,
            string message)
        {
            Code = code ?? "";
            Status = status ?? "information";
            SegmentId = segmentId ?? "";
            SourceId = sourceId ?? "";
            Message = message ?? "";
        }

        public string Code { get; private set; }
        public string Status { get; private set; }
        public string SegmentId { get; private set; }
        public string SourceId { get; private set; }
        public string Message { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return BomInstanceCoverageMaps.Map(
                "code", Code,
                "status", Status,
                "segment_id", SegmentId,
                "source_id", SourceId,
                "message", Message);
        }
    }

    public sealed class BomInstanceCoverageItemRecord
    {
        internal BomInstanceCoverageItemRecord(
            string tableId,
            MechanicalBomRowKnowledge row)
        {
            TableId = tableId ?? "";
            RowId = row == null ? "" : row.Id;
            ItemNumber = row == null ? null : row.ItemNumber;
            Values = new Dictionary<string, string>(StringComparer.Ordinal);
            ParsedValues = new Dictionary<string, object>(StringComparer.Ordinal);
            if (row == null) { return; }
            CopyValue(row.Values, Values, "part_number");
            CopyValue(row.Values, Values, "name");
            CopyValue(row.Values, Values, "quantity");
            object parsedQuantity;
            if (row.ParsedValues.TryGetValue("quantity", out parsedQuantity))
            {
                ParsedValues["quantity"] = parsedQuantity;
            }
        }

        public string TableId { get; private set; }
        public string RowId { get; private set; }
        public int? ItemNumber { get; private set; }
        public IDictionary<string, string> Values { get; private set; }
        public IDictionary<string, object> ParsedValues { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return BomInstanceCoverageMaps.Map(
                "table_id", TableId,
                "row_id", RowId,
                "item_number", ItemNumber.HasValue ? (object)ItemNumber.Value : null,
                "values", new Dictionary<string, string>(Values, StringComparer.Ordinal),
                "parsed_values", new Dictionary<string, object>(ParsedValues, StringComparer.Ordinal));
        }

        static void CopyValue(
            IDictionary<string, string> source,
            IDictionary<string, string> target,
            string key)
        {
            string value;
            target[key] = source != null && source.TryGetValue(key, out value)
                ? value
                : "";
        }
    }

    public sealed class BomInstanceCoverageAnchorRecord
    {
        internal BomInstanceCoverageAnchorRecord(
            double[] targetPoint,
            InstanceOccurrenceRecord leaf,
            string ownerPrefix,
            InstanceOccurrenceRecord blockReference,
            double distance,
            double tolerance)
        {
            TargetPoint = targetPoint == null ? null : (double[])targetPoint.Clone();
            LeafOccurrenceId = leaf == null ? "" : leaf.Id;
            LeafSourceHandle = leaf == null ? "" : leaf.SourceHandle;
            OwnerPrefix = ownerPrefix ?? "";
            BlockReferenceOccurrenceId = blockReference == null ? "" : blockReference.Id;
            TargetDefinitionHandle = blockReference == null
                ? ""
                : blockReference.TargetDefinitionHandle;
            TargetDefinitionName = blockReference == null
                ? ""
                : blockReference.TargetDefinitionName;
            Distance = distance;
            DistanceTolerance = tolerance;
        }

        public double[] TargetPoint { get; private set; }
        public string LeafOccurrenceId { get; private set; }
        public string LeafSourceHandle { get; private set; }
        public string OwnerPrefix { get; private set; }
        public string BlockReferenceOccurrenceId { get; private set; }
        public string TargetDefinitionHandle { get; private set; }
        public string TargetDefinitionName { get; private set; }
        public double Distance { get; private set; }
        public double DistanceTolerance { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return BomInstanceCoverageMaps.Map(
                "target_point", TargetPoint,
                "leaf_occurrence_id", LeafOccurrenceId,
                "leaf_source_handle", LeafSourceHandle,
                "owner_prefix", OwnerPrefix,
                "block_reference_occurrence_id", BlockReferenceOccurrenceId,
                "target_definition_handle", TargetDefinitionHandle,
                "target_definition_name", TargetDefinitionName,
                "distance", Distance,
                "distance_tolerance", DistanceTolerance);
        }
    }

    public sealed class BomInstanceCoverageInstanceRecord
    {
        readonly List<int> pointedItemNumbers;
        readonly List<string> pointedAnnotationHandles;
        readonly List<string> pointedSegmentIds;

        internal BomInstanceCoverageInstanceRecord(
            InstanceOccurrenceRecord occurrence,
            string classification,
            double[] footprintBounds,
            EngineeringViewRegionRecord region,
            IEnumerable<int> itemNumbers,
            IEnumerable<string> annotationHandles,
            IEnumerable<string> segmentIds)
        {
            OccurrenceId = occurrence == null ? "" : occurrence.Id;
            SourceHandle = occurrence == null ? "" : occurrence.SourceHandle;
            TargetDefinitionHandle = occurrence == null
                ? ""
                : occurrence.TargetDefinitionHandle;
            TargetDefinitionName = occurrence == null
                ? ""
                : occurrence.TargetDefinitionName;
            Position = occurrence == null
                ? null
                : new[]
                {
                    occurrence.WorldTransform[0, 3],
                    occurrence.WorldTransform[1, 3]
                };
            Mirrored = occurrence != null && occurrence.WorldTransform.IsMirrored;
            MInsertRow = occurrence == null ? 0 : occurrence.Row;
            MInsertColumn = occurrence == null ? 0 : occurrence.Column;
            Classification = classification ?? "unpointed_candidate";
            FootprintBounds = footprintBounds == null
                ? null
                : (double[])footprintBounds.Clone();
            ViewRegionId = region == null ? "" : region.Id;
            ViewRegionKind = region == null ? "unassigned" : region.Kind;
            pointedItemNumbers = SortedUnique(itemNumbers);
            pointedAnnotationHandles = SortedUnique(annotationHandles);
            pointedSegmentIds = SortedUnique(segmentIds);
        }

        public string OccurrenceId { get; private set; }
        public string SourceHandle { get; private set; }
        public string TargetDefinitionHandle { get; private set; }
        public string TargetDefinitionName { get; private set; }
        public double[] Position { get; private set; }
        public bool Mirrored { get; private set; }
        public int MInsertRow { get; private set; }
        public int MInsertColumn { get; private set; }
        public string Classification { get; private set; }
        public double[] FootprintBounds { get; private set; }
        public string ViewRegionId { get; private set; }
        public string ViewRegionKind { get; private set; }
        public IList<int> PointedItemNumbers { get { return pointedItemNumbers.AsReadOnly(); } }
        public IList<string> PointedAnnotationHandles { get { return pointedAnnotationHandles.AsReadOnly(); } }
        public IList<string> PointedSegmentIds { get { return pointedSegmentIds.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return BomInstanceCoverageMaps.Map(
                "occurrence_id", OccurrenceId,
                "source_handle", SourceHandle,
                "target_definition_handle", TargetDefinitionHandle,
                "target_definition_name", TargetDefinitionName,
                "position", Position,
                "mirrored", Mirrored,
                "minsert_row", MInsertRow,
                "minsert_column", MInsertColumn,
                "footprint_bounds", FootprintBounds,
                "view_region_id", string.IsNullOrEmpty(ViewRegionId) ? null : (object)ViewRegionId,
                "view_region_kind", ViewRegionKind,
                "classification", Classification,
                "pointing_evidence", BomInstanceCoverageMaps.Map(
                    "item_numbers", new List<int>(pointedItemNumbers),
                    "annotation_handles", new List<string>(pointedAnnotationHandles),
                    "segment_ids", new List<string>(pointedSegmentIds)));
        }

        static List<int> SortedUnique(IEnumerable<int> values)
        {
            return values == null
                ? new List<int>()
                : values.Distinct().OrderBy(value => value).ToList();
        }

        static List<string> SortedUnique(IEnumerable<string> values)
        {
            return values == null
                ? new List<string>()
                : values.Where(value => !string.IsNullOrEmpty(value))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .OrderBy(value => value, StringComparer.Ordinal)
                    .ToList();
        }
    }

    public sealed class BomInstanceCoverageViewSummaryRecord
    {
        readonly Dictionary<string, int> classificationCounts;

        internal BomInstanceCoverageViewSummaryRecord(
            string regionId,
            string regionKind,
            IEnumerable<BomInstanceCoverageInstanceRecord> instances)
        {
            RegionId = regionId ?? "";
            RegionKind = regionKind ?? "unassigned";
            classificationCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (BomInstanceCoverageInstanceRecord instance in
                instances ?? Enumerable.Empty<BomInstanceCoverageInstanceRecord>())
            {
                int count;
                classificationCounts.TryGetValue(instance.Classification, out count);
                classificationCounts[instance.Classification] = count + 1;
                InstanceCount++;
            }
        }

        public string RegionId { get; private set; }
        public string RegionKind { get; private set; }
        public int InstanceCount { get; private set; }
        public IDictionary<string, int> ClassificationCounts
        {
            get { return new Dictionary<string, int>(classificationCounts, StringComparer.Ordinal); }
        }

        public Dictionary<string, object> ToMap()
        {
            return BomInstanceCoverageMaps.Map(
                "view_region_id", string.IsNullOrEmpty(RegionId) ? null : (object)RegionId,
                "view_region_kind", RegionKind,
                "instance_count", InstanceCount,
                "classification_counts", new Dictionary<string, int>(classificationCounts));
        }
    }

    public sealed class BomInstanceCoverageSegmentRecord
    {
        readonly List<int> itemNumbers;
        readonly List<BomInstanceCoverageItemRecord> bomItems;
        readonly List<BomInstanceCoverageInstanceRecord> instances;
        readonly List<BomInstanceCoverageViewSummaryRecord> viewSummaries;
        readonly List<BomInstanceCoverageDiagnosticRecord> diagnostics;

        internal BomInstanceCoverageSegmentRecord(
            string id,
            string tableId,
            string sourceGroupId,
            string groupType,
            string sourceTargetStatus,
            double[] targetPoint,
            IEnumerable<int> sourceItemNumbers)
        {
            Id = id ?? "";
            TableId = tableId ?? "";
            SourceGroupId = sourceGroupId ?? "";
            GroupType = groupType ?? "";
            SourceTargetStatus = sourceTargetStatus ?? "";
            Status = sourceTargetStatus ?? "target_position_unavailable";
            TargetPoint = targetPoint == null ? null : (double[])targetPoint.Clone();
            itemNumbers = sourceItemNumbers == null
                ? new List<int>()
                : sourceItemNumbers.Distinct().OrderBy(value => value).ToList();
            bomItems = new List<BomInstanceCoverageItemRecord>();
            instances = new List<BomInstanceCoverageInstanceRecord>();
            viewSummaries = new List<BomInstanceCoverageViewSummaryRecord>();
            diagnostics = new List<BomInstanceCoverageDiagnosticRecord>();
        }

        public string Id { get; private set; }
        public string TableId { get; private set; }
        public string SourceGroupId { get; private set; }
        public string GroupType { get; private set; }
        public string SourceTargetStatus { get; private set; }
        public string Status { get; internal set; }
        public double[] TargetPoint { get; private set; }
        public BomInstanceCoverageAnchorRecord Anchor { get; internal set; }
        public bool IsMatchable { get; internal set; }
        public int DefinitionInstanceCount { get; internal set; }
        public int EmittedInstanceDetailCount { get; internal set; }
        public bool InstanceDetailsTruncated { get; internal set; }
        public int PointedCount { get; internal set; }
        public int PointedByOtherItemCount { get; internal set; }
        public int UnpointedCandidateCount { get; internal set; }
        public int DocumentationRegionCount { get; internal set; }
        public IList<int> ItemNumbers { get { return itemNumbers.AsReadOnly(); } }
        public IList<BomInstanceCoverageItemRecord> BomItems { get { return bomItems.AsReadOnly(); } }
        public IList<BomInstanceCoverageInstanceRecord> Instances { get { return instances.AsReadOnly(); } }
        public IList<BomInstanceCoverageViewSummaryRecord> ViewSummaries { get { return viewSummaries.AsReadOnly(); } }
        public IList<BomInstanceCoverageDiagnosticRecord> Diagnostics { get { return diagnostics.AsReadOnly(); } }

        internal void AddBomItem(BomInstanceCoverageItemRecord value)
        {
            if (value != null) { bomItems.Add(value); }
        }

        internal void AddInstance(BomInstanceCoverageInstanceRecord value)
        {
            if (value != null) { instances.Add(value); }
        }

        internal void AddViewSummary(BomInstanceCoverageViewSummaryRecord value)
        {
            if (value != null) { viewSummaries.Add(value); }
        }

        internal void AddDiagnostic(BomInstanceCoverageDiagnosticRecord value)
        {
            if (value != null) { diagnostics.Add(value); }
        }

        public Dictionary<string, object> ToMap()
        {
            return BomInstanceCoverageMaps.Map(
                "segment_id", Id,
                "table_id", TableId,
                "source_group_id", SourceGroupId,
                "group_type", GroupType,
                "source_target_status", SourceTargetStatus,
                "status", Status,
                "item_numbers", new List<int>(itemNumbers),
                "target_point", TargetPoint,
                "bom_items", bomItems.Select(value => value.ToMap()).ToList(),
                "anchor", Anchor == null ? null : Anchor.ToMap(),
                "target_definition", Anchor == null
                    ? null
                    : BomInstanceCoverageMaps.Map(
                        "handle", Anchor.TargetDefinitionHandle,
                        "name", Anchor.TargetDefinitionName),
                "matchable", IsMatchable,
                "coverage_counts", BomInstanceCoverageMaps.Map(
                    "definition_instance_count", DefinitionInstanceCount,
                    "pointed", PointedCount,
                    "pointed_by_other_item", PointedByOtherItemCount,
                    "unpointed_candidate", UnpointedCandidateCount,
                    "in_documentation_region", DocumentationRegionCount),
                "instance_detail_count", EmittedInstanceDetailCount,
                "instance_details_truncated", InstanceDetailsTruncated,
                "view_summaries", viewSummaries.Select(value => value.ToMap()).ToList(),
                "instances", instances.Select(value => value.ToMap()).ToList(),
                "diagnostics", diagnostics.Select(value => value.ToMap()).ToList());
        }
    }

    public sealed class BomInstanceCoverageDocument
    {
        readonly List<BomInstanceCoverageSegmentRecord> segments;
        readonly List<BomInstanceCoverageDiagnosticRecord> diagnostics;

        internal BomInstanceCoverageDocument(
            string drawingId,
            double anchorDistanceTolerance,
            IList<BomInstanceCoverageSegmentRecord> values,
            IList<BomInstanceCoverageDiagnosticRecord> diagnosticValues)
        {
            DrawingId = drawingId ?? "";
            AnchorDistanceTolerance = anchorDistanceTolerance;
            segments = values == null
                ? new List<BomInstanceCoverageSegmentRecord>()
                : new List<BomInstanceCoverageSegmentRecord>(values);
            diagnostics = diagnosticValues == null
                ? new List<BomInstanceCoverageDiagnosticRecord>()
                : new List<BomInstanceCoverageDiagnosticRecord>(diagnosticValues);
            SegmentCount = segments.Count;
            MatchableSegmentCount = segments.Count(value => value.IsMatchable);
            NotMatchableCount = SegmentCount - MatchableSegmentCount;
            UnpointedCandidateCount = segments.Sum(value => value.UnpointedCandidateCount);
            if (segments.Any(value => value.InstanceDetailsTruncated)
                || diagnostics.Any(value => value.Status == "unsupported"))
            {
                Status = "unsupported_partial";
            }
            else if (segments.Any(value => value.Status == "anchor_unresolved"
                    || value.Status == "multiple_external_targets")
                || diagnostics.Any(value => value.Status == "ambiguous"))
            {
                Status = "ambiguous";
            }
            else
            {
                Status = "computed";
            }
        }

        public string DrawingId { get; private set; }
        public string Status { get; private set; }
        public double AnchorDistanceTolerance { get; private set; }
        public int SegmentCount { get; private set; }
        public int MatchableSegmentCount { get; private set; }
        public int UnpointedCandidateCount { get; private set; }
        public int NotMatchableCount { get; private set; }
        public IList<BomInstanceCoverageSegmentRecord> Segments { get { return segments.AsReadOnly(); } }
        public IList<BomInstanceCoverageDiagnosticRecord> Diagnostics { get { return diagnostics.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return BomInstanceCoverageMaps.Map(
                "schema_version", "1",
                "analysis_type", "bom_instance_coverage",
                "analyzer_version", "1",
                "drawing_id", DrawingId,
                "status", Status,
                "anchor_distance_tolerance", AnchorDistanceTolerance,
                "segment_count", SegmentCount,
                "matchable_segment_count", MatchableSegmentCount,
                "unpointed_candidate_count", UnpointedCandidateCount,
                "not_matchable_count", NotMatchableCount,
                "segments", segments.Select(value => value.ToMap()).ToList(),
                "diagnostics", diagnostics.Select(value => value.ToMap()).ToList(),
                "semantic_contract", BomInstanceCoverageMaps.Map(
                    "instance_class_identity", "same_target_definition_handle_not_physical_object_identity",
                    "unpointed_candidate", "same_definition_and_not_resolved_from_any_serial_annotation_not_bom_error",
                    "view_scope", "smallest_non_sheet_region_no_cross_view_identity_merge",
                    "quantity", "raw_and_parsed_bom_evidence_parallel_to_counts_no_verdict",
                    "loose_geometry", "not_matchable_in_v1",
                    "allowed_explanations", new[]
                    {
                        "multiple_view_repetition",
                        "symmetric_drawing_expression",
                        "schematic_or_documentation_expression"
                    }),
                "mutation_status", "read_only_no_entities_modified");
        }

        public string ToMarkdown()
        {
            var builder = new StringBuilder();
            builder.AppendLine("# BOM 实例覆盖对账");
            builder.AppendLine();
            builder.AppendLine("- 图纸：`" + DrawingId + "`");
            builder.AppendLine("- 状态：`" + Status + "`");
            builder.AppendLine("- 序号段 / 可按块定义对账："
                + SegmentCount.ToString(CultureInfo.InvariantCulture)
                + " / " + MatchableSegmentCount.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine("- 未被任何序号指向的同定义实例候选："
                + UnpointedCandidateCount.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine("- 本版不可对账段："
                + NotMatchableCount.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine();
            foreach (BomInstanceCoverageSegmentRecord segment in segments)
            {
                builder.AppendLine("## " + segment.Id);
                builder.AppendLine();
                builder.AppendLine("- 序号："
                    + string.Join(", ", segment.ItemNumbers.Select(
                        value => value.ToString(CultureInfo.InvariantCulture)).ToArray()));
                builder.AppendLine("- 状态：`" + segment.Status + "`");
                if (segment.IsMatchable)
                {
                    builder.AppendLine("- 同定义实例 / 本段指向 / 其他序号指向 / 未指向候选 / 文档区："
                        + segment.DefinitionInstanceCount.ToString(CultureInfo.InvariantCulture)
                        + " / " + segment.PointedCount.ToString(CultureInfo.InvariantCulture)
                        + " / " + segment.PointedByOtherItemCount.ToString(CultureInfo.InvariantCulture)
                        + " / " + segment.UnpointedCandidateCount.ToString(CultureInfo.InvariantCulture)
                        + " / " + segment.DocumentationRegionCount.ToString(CultureInfo.InvariantCulture));
                }
                builder.AppendLine();
            }
            builder.AppendLine("`unpointed_candidate` 只表示同块定义且未被已解析序号指向；多视图、对称或示意表达都可能合法，本能力不判定漏标、数量错误或 BOM 错误。");
            return builder.ToString().TrimEnd();
        }
    }

    public static class BomInstanceCoverageAnalyzer
    {
        sealed class PointResolution
        {
            public InstanceOccurrenceRecord Leaf;
            public string OwnerPrefix;
            public InstanceOccurrenceRecord BlockReference;
            public double Distance;
        }

        sealed class PointingEvidence
        {
            public string SegmentId;
            public int ItemNumber;
            public string AnnotationHandle;
        }

        public static BomInstanceCoverageDocument Analyze(
            MechanicalBomKnowledgeDocument bom,
            BlockInstanceCoordinateDocument instances,
            EngineeringViewRegionDocument regions,
            BomInstanceCoverageConfig config = null)
        {
            if (bom == null) { throw new ArgumentNullException("bom"); }
            if (instances == null) { throw new ArgumentNullException("instances"); }
            if (regions == null) { throw new ArgumentNullException("regions"); }
            config = config ?? new BomInstanceCoverageConfig();
            ValidateConfig(config);

            var leaves = instances.Occurrences
                .Where(value => value != null
                    && !value.IsBlockReference
                    && (value.HasWorldPath || value.HasBounds))
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .ToList();
            var referencesById = instances.Occurrences
                .Where(value => value != null && value.IsBlockReference)
                .GroupBy(value => value.Id, StringComparer.OrdinalIgnoreCase)
                .ToDictionary(
                    value => value.Key,
                    value => value.OrderBy(item => item.Id, StringComparer.Ordinal).First(),
                    StringComparer.OrdinalIgnoreCase);
            double anchorTolerance = ResolveAnchorTolerance(leaves, config);
            var globalDiagnostics = new List<BomInstanceCoverageDiagnosticRecord>();
            if (leaves.Count == 0)
            {
                globalDiagnostics.Add(new BomInstanceCoverageDiagnosticRecord(
                    "NO_LEAF_GEOMETRY",
                    "unsupported",
                    "",
                    "",
                    "Capability 11 supplied no leaf world path or bounds for BOM target anchoring."));
            }

            var pointedByOwner = BuildPointedIndex(
                bom,
                leaves,
                referencesById,
                anchorTolerance);
            var segments = new List<BomInstanceCoverageSegmentRecord>();
            foreach (MechanicalBomTableKnowledge table in bom.Tables)
            {
                foreach (MechanicalBomSerialAnnotationGroupKnowledge group in
                    table.SerialAnnotationGroups)
                {
                    string segmentId = StableSegmentId(table.Id, group.Id);
                    var segment = new BomInstanceCoverageSegmentRecord(
                        segmentId,
                        table.Id,
                        group.Id,
                        group.GroupType,
                        group.TargetStatus,
                        group.TargetPoint,
                        group.ItemNumbers);
                    AddBomItems(segment, table, group.ItemNumbers);
                    AnalyzeSegment(
                        segment,
                        group,
                        instances,
                        regions,
                        leaves,
                        referencesById,
                        pointedByOwner,
                        anchorTolerance,
                        config);
                    segments.Add(segment);
                }
            }
            return new BomInstanceCoverageDocument(
                string.IsNullOrEmpty(bom.DrawingId) ? instances.DrawingId : bom.DrawingId,
                anchorTolerance,
                segments,
                globalDiagnostics);
        }

        static void AnalyzeSegment(
            BomInstanceCoverageSegmentRecord segment,
            MechanicalBomSerialAnnotationGroupKnowledge group,
            BlockInstanceCoordinateDocument instances,
            EngineeringViewRegionDocument regions,
            IList<InstanceOccurrenceRecord> leaves,
            IDictionary<string, InstanceOccurrenceRecord> referencesById,
            IDictionary<string, List<PointingEvidence>> pointedByOwner,
            double anchorTolerance,
            BomInstanceCoverageConfig config)
        {
            if (!string.Equals(
                group.TargetStatus,
                "resolved_shared_target",
                StringComparison.Ordinal))
            {
                segment.Status = group.TargetStatus;
                segment.AddDiagnostic(new BomInstanceCoverageDiagnosticRecord(
                    "SERIAL_TARGET_NOT_RESOLVED",
                    group.TargetStatus == "multiple_external_targets" ? "ambiguous" : "information",
                    segment.Id,
                    group.Id,
                    "The serial segment is retained but no instance enumeration is performed without one resolved shared target."));
                return;
            }

            PointResolution resolution = ResolvePoint(
                group.TargetPoint,
                leaves,
                referencesById);
            if (resolution == null || resolution.Leaf == null)
            {
                segment.Status = "anchor_unresolved";
                segment.AddDiagnostic(new BomInstanceCoverageDiagnosticRecord(
                    "ANCHOR_LEAF_NOT_FOUND",
                    "ambiguous",
                    segment.Id,
                    group.Id,
                    "No leaf occurrence with a world path or bounds can anchor the resolved serial target."));
                return;
            }
            segment.Anchor = new BomInstanceCoverageAnchorRecord(
                group.TargetPoint,
                resolution.Leaf,
                resolution.OwnerPrefix,
                resolution.BlockReference,
                resolution.Distance,
                anchorTolerance);
            if (resolution.Distance > anchorTolerance)
            {
                segment.Status = "anchor_unresolved";
                segment.AddDiagnostic(new BomInstanceCoverageDiagnosticRecord(
                    "ANCHOR_DISTANCE_EXCEEDED",
                    "ambiguous",
                    segment.Id,
                    resolution.Leaf.Id,
                    "Nearest leaf distance exceeds the drawing-adaptive anchor tolerance."));
                return;
            }
            if (string.IsNullOrEmpty(resolution.OwnerPrefix))
            {
                segment.Status = "not_matchable_loose_geometry";
                segment.AddDiagnostic(new BomInstanceCoverageDiagnosticRecord(
                    "LOOSE_GEOMETRY_ANCHOR",
                    "information",
                    segment.Id,
                    resolution.Leaf.Id,
                    "The target resolves to root-space loose geometry without a containing block reference; topology-signature matching is outside v1."));
                return;
            }
            if (resolution.BlockReference == null
                || string.IsNullOrEmpty(resolution.BlockReference.TargetDefinitionHandle))
            {
                segment.Status = "anchor_unresolved";
                segment.AddDiagnostic(new BomInstanceCoverageDiagnosticRecord(
                    "ANCHOR_BLOCK_REFERENCE_NOT_FOUND",
                    "ambiguous",
                    segment.Id,
                    resolution.OwnerPrefix,
                    "The leaf owner prefix does not resolve to a block-reference occurrence with a target definition handle."));
                return;
            }

            string targetDefinitionHandle = resolution.BlockReference.TargetDefinitionHandle;
            var matchingReferences = instances.Occurrences
                .Where(value => value != null
                    && value.IsBlockReference
                    && string.Equals(
                        value.TargetDefinitionHandle,
                        targetDefinitionHandle,
                        StringComparison.OrdinalIgnoreCase))
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .ToList();
            segment.IsMatchable = true;
            segment.Status = "computed";
            segment.DefinitionInstanceCount = matchingReferences.Count;

            string definitionName = resolution.BlockReference.TargetDefinitionName ?? "";
            if (definitionName.StartsWith("*U", StringComparison.OrdinalIgnoreCase)
                || definitionName.StartsWith("A$", StringComparison.OrdinalIgnoreCase))
            {
                segment.AddDiagnostic(new BomInstanceCoverageDiagnosticRecord(
                    "ANONYMOUS_BLOCK_MATCHED_BY_HANDLE",
                    "known_limit",
                    segment.Id,
                    targetDefinitionHandle,
                    "Anonymous block instances are reconciled by effective target definition handle, not by name."));
            }
            if (matchingReferences.Any(value => value.IsDynamicBlock))
            {
                segment.AddDiagnostic(new BomInstanceCoverageDiagnosticRecord(
                    "DYNAMIC_BLOCK_EFFECTIVE_DEFINITION_ONLY",
                    "known_limit",
                    segment.Id,
                    targetDefinitionHandle,
                    "Capability 11 currently exposes effective target definitions in occurrence facts; authoring-definition variant collapse is not performed."));
            }

            var allDetails = new List<BomInstanceCoverageInstanceRecord>();
            foreach (InstanceOccurrenceRecord occurrence in matchingReferences)
            {
                List<PointingEvidence> evidence;
                if (!pointedByOwner.TryGetValue(occurrence.Id, out evidence))
                {
                    evidence = new List<PointingEvidence>();
                }
                var current = evidence.Where(value => string.Equals(
                        value.SegmentId,
                        segment.Id,
                        StringComparison.OrdinalIgnoreCase))
                    .ToList();
                var other = evidence.Where(value => !string.Equals(
                        value.SegmentId,
                        segment.Id,
                        StringComparison.OrdinalIgnoreCase))
                    .ToList();
                double x = occurrence.WorldTransform[0, 3];
                double y = occurrence.WorldTransform[1, 3];
                EngineeringViewRegionRecord region = ChooseRegion(regions, x, y);
                string classification;
                IEnumerable<PointingEvidence> usedEvidence;
                if (current.Count > 0)
                {
                    classification = "pointed";
                    usedEvidence = current;
                    segment.PointedCount++;
                }
                else if (other.Count > 0)
                {
                    classification = "pointed_by_other_item";
                    usedEvidence = other;
                    segment.PointedByOtherItemCount++;
                }
                else if (region != null && region.Kind == "documentation_region")
                {
                    classification = "in_documentation_region";
                    usedEvidence = Enumerable.Empty<PointingEvidence>();
                    segment.DocumentationRegionCount++;
                }
                else
                {
                    classification = "unpointed_candidate";
                    usedEvidence = Enumerable.Empty<PointingEvidence>();
                    segment.UnpointedCandidateCount++;
                }
                var selectedEvidence = usedEvidence.ToList();
                allDetails.Add(new BomInstanceCoverageInstanceRecord(
                    occurrence,
                    classification,
                    FootprintBounds(occurrence.Id, leaves),
                    region,
                    selectedEvidence.Select(value => value.ItemNumber),
                    selectedEvidence.Select(value => value.AnnotationHandle),
                    selectedEvidence.Select(value => value.SegmentId)));
            }

            foreach (BomInstanceCoverageInstanceRecord detail in
                allDetails.Take(config.MaximumInstanceDetails))
            {
                segment.AddInstance(detail);
            }
            segment.EmittedInstanceDetailCount = segment.Instances.Count;
            segment.InstanceDetailsTruncated = allDetails.Count > segment.Instances.Count;
            if (segment.InstanceDetailsTruncated)
            {
                segment.Status = "computed_truncated";
                segment.AddDiagnostic(new BomInstanceCoverageDiagnosticRecord(
                    "INSTANCE_DETAIL_LIMIT_REACHED",
                    "unsupported",
                    segment.Id,
                    targetDefinitionHandle,
                    "Complete classification counts are retained, but emitted instance details were truncated at the configured limit."));
            }
            foreach (IGrouping<string, BomInstanceCoverageInstanceRecord> viewGroup in
                allDetails.GroupBy(
                    value => string.IsNullOrEmpty(value.ViewRegionId)
                        ? ""
                        : value.ViewRegionId,
                    StringComparer.Ordinal)
                    .OrderBy(value => value.Key, StringComparer.Ordinal))
            {
                BomInstanceCoverageInstanceRecord first = viewGroup.First();
                segment.AddViewSummary(new BomInstanceCoverageViewSummaryRecord(
                    first.ViewRegionId,
                    first.ViewRegionKind,
                    viewGroup));
            }
        }

        static IDictionary<string, List<PointingEvidence>> BuildPointedIndex(
            MechanicalBomKnowledgeDocument bom,
            IList<InstanceOccurrenceRecord> leaves,
            IDictionary<string, InstanceOccurrenceRecord> referencesById,
            double anchorTolerance)
        {
            var result = new Dictionary<string, List<PointingEvidence>>(
                StringComparer.OrdinalIgnoreCase);
            foreach (MechanicalBomTableKnowledge table in bom.Tables)
            {
                foreach (MechanicalBomSerialAnnotationGroupKnowledge group in
                    table.SerialAnnotationGroups)
                {
                    string segmentId = StableSegmentId(table.Id, group.Id);
                    foreach (MechanicalBomAnnotationObservation annotation in
                        group.OrderedMembers)
                    {
                        if (!HasPoint(annotation.PointingPosition)) { continue; }
                        PointResolution resolution = ResolvePoint(
                            annotation.PointingPosition,
                            leaves,
                            referencesById);
                        if (resolution == null
                            || resolution.BlockReference == null
                            || resolution.Distance > anchorTolerance
                            || string.IsNullOrEmpty(resolution.OwnerPrefix))
                        {
                            continue;
                        }
                        List<PointingEvidence> values;
                        if (!result.TryGetValue(resolution.OwnerPrefix, out values))
                        {
                            values = new List<PointingEvidence>();
                            result[resolution.OwnerPrefix] = values;
                        }
                        values.Add(new PointingEvidence
                        {
                            SegmentId = segmentId,
                            ItemNumber = annotation.ItemNumber,
                            AnnotationHandle = annotation.XuhaoHandle
                        });
                    }
                }
            }
            return result;
        }

        static void AddBomItems(
            BomInstanceCoverageSegmentRecord segment,
            MechanicalBomTableKnowledge table,
            IEnumerable<int> itemNumbers)
        {
            var selected = new HashSet<int>(itemNumbers ?? Enumerable.Empty<int>());
            foreach (MechanicalBomRowKnowledge row in table.Rows
                .Where(value => value.ItemNumber.HasValue
                    && selected.Contains(value.ItemNumber.Value))
                .OrderBy(value => value.ItemNumber.Value)
                .ThenBy(value => value.Id, StringComparer.Ordinal))
            {
                segment.AddBomItem(new BomInstanceCoverageItemRecord(table.Id, row));
            }
        }

        static PointResolution ResolvePoint(
            double[] point,
            IList<InstanceOccurrenceRecord> leaves,
            IDictionary<string, InstanceOccurrenceRecord> referencesById)
        {
            if (!HasPoint(point) || leaves == null || leaves.Count == 0) { return null; }
            InstanceOccurrenceRecord nearest = null;
            double nearestDistance = double.PositiveInfinity;
            foreach (InstanceOccurrenceRecord leaf in leaves)
            {
                double distance = DistanceToOccurrence(point[0], point[1], leaf);
                if (distance < nearestDistance - 1e-12
                    || (Math.Abs(distance - nearestDistance) <= 1e-12
                        && nearest != null
                        && string.Compare(leaf.Id, nearest.Id, StringComparison.Ordinal) < 0))
                {
                    nearest = leaf;
                    nearestDistance = distance;
                }
            }
            if (nearest == null) { return null; }
            string owner = OwnerPrefix(nearest.Id);
            InstanceOccurrenceRecord blockReference = null;
            if (!string.IsNullOrEmpty(owner))
            {
                referencesById.TryGetValue(owner, out blockReference);
            }
            return new PointResolution
            {
                Leaf = nearest,
                OwnerPrefix = owner,
                BlockReference = blockReference,
                Distance = nearestDistance
            };
        }

        static string OwnerPrefix(string occurrenceId)
        {
            if (string.IsNullOrEmpty(occurrenceId)) { return null; }
            int entity = occurrenceId.LastIndexOf("/ent:", StringComparison.Ordinal);
            if (entity < 0) { return null; }
            string prefix = occurrenceId.Substring(0, entity);
            return prefix.IndexOf("/ref:", StringComparison.Ordinal) >= 0
                ? prefix
                : null;
        }

        static double[] FootprintBounds(
            string ownerPrefix,
            IEnumerable<InstanceOccurrenceRecord> leaves)
        {
            bool found = false;
            double minX = double.PositiveInfinity;
            double minY = double.PositiveInfinity;
            double maxX = double.NegativeInfinity;
            double maxY = double.NegativeInfinity;
            string childPrefix = (ownerPrefix ?? "") + "/";
            foreach (InstanceOccurrenceRecord leaf in leaves)
            {
                if (leaf == null
                    || !leaf.HasBounds
                    || !leaf.Id.StartsWith(childPrefix, StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }
                found = true;
                minX = Math.Min(minX, leaf.MinX);
                minY = Math.Min(minY, leaf.MinY);
                maxX = Math.Max(maxX, leaf.MaxX);
                maxY = Math.Max(maxY, leaf.MaxY);
            }
            return found ? new[] { minX, minY, maxX, maxY } : null;
        }

        static EngineeringViewRegionRecord ChooseRegion(
            EngineeringViewRegionDocument document,
            double x,
            double y)
        {
            return document.Regions
                .Where(value => value != null
                    && value.Kind != "sheet_structure_region"
                    && x >= value.MinX
                    && x <= value.MaxX
                    && y >= value.MinY
                    && y <= value.MaxY)
                .OrderBy(value => value.Area)
                .ThenBy(value => value.Id, StringComparer.Ordinal)
                .FirstOrDefault();
        }

        static double ResolveAnchorTolerance(
            IList<InstanceOccurrenceRecord> leaves,
            BomInstanceCoverageConfig config)
        {
            if (config.ExplicitAnchorDistanceTolerance > 0)
            {
                return config.ExplicitAnchorDistanceTolerance;
            }
            bool found = false;
            double minX = double.PositiveInfinity;
            double minY = double.PositiveInfinity;
            double maxX = double.NegativeInfinity;
            double maxY = double.NegativeInfinity;
            var spans = new List<double>();
            foreach (InstanceOccurrenceRecord leaf in leaves)
            {
                if (leaf == null || !leaf.HasBounds) { continue; }
                found = true;
                minX = Math.Min(minX, leaf.MinX);
                minY = Math.Min(minY, leaf.MinY);
                maxX = Math.Max(maxX, leaf.MaxX);
                maxY = Math.Max(maxY, leaf.MaxY);
                double span = Math.Max(leaf.MaxX - leaf.MinX, leaf.MaxY - leaf.MinY);
                if (span > 1e-12) { spans.Add(span); }
            }
            double diagonalTolerance = double.PositiveInfinity;
            if (found)
            {
                double dx = maxX - minX;
                double dy = maxY - minY;
                diagonalTolerance = Math.Sqrt(dx * dx + dy * dy)
                    * config.AnchorDistanceDrawingDiagonalRatio;
            }
            double spanTolerance = double.PositiveInfinity;
            if (spans.Count > 0)
            {
                spans.Sort();
                double median = spans.Count % 2 == 1
                    ? spans[spans.Count / 2]
                    : (spans[spans.Count / 2 - 1] + spans[spans.Count / 2]) * 0.5;
                spanTolerance = median * config.AnchorDistanceMedianLeafSpanMultiplier;
            }
            double automatic = Math.Min(diagonalTolerance, spanTolerance);
            if (double.IsInfinity(automatic) || double.IsNaN(automatic))
            {
                automatic = config.MinimumAnchorDistanceTolerance;
            }
            return Math.Max(config.MinimumAnchorDistanceTolerance, automatic);
        }

        static double DistanceToOccurrence(
            double x,
            double y,
            InstanceOccurrenceRecord occurrence)
        {
            if (occurrence.HasWorldPath)
            {
                double best = double.PositiveInfinity;
                for (int index = 1; index < occurrence.WorldPath.Count; index++)
                {
                    best = Math.Min(best, DistanceToSegment(
                        x,
                        y,
                        occurrence.WorldPath[index - 1].X,
                        occurrence.WorldPath[index - 1].Y,
                        occurrence.WorldPath[index].X,
                        occurrence.WorldPath[index].Y));
                }
                if (occurrence.IsClosed && occurrence.WorldPath.Count > 2)
                {
                    int last = occurrence.WorldPath.Count - 1;
                    best = Math.Min(best, DistanceToSegment(
                        x,
                        y,
                        occurrence.WorldPath[last].X,
                        occurrence.WorldPath[last].Y,
                        occurrence.WorldPath[0].X,
                        occurrence.WorldPath[0].Y));
                }
                return best;
            }
            if (occurrence.HasBounds)
            {
                double dx = x < occurrence.MinX
                    ? occurrence.MinX - x
                    : x > occurrence.MaxX ? x - occurrence.MaxX : 0;
                double dy = y < occurrence.MinY
                    ? occurrence.MinY - y
                    : y > occurrence.MaxY ? y - occurrence.MaxY : 0;
                return Math.Sqrt(dx * dx + dy * dy);
            }
            return double.PositiveInfinity;
        }

        static double DistanceToSegment(
            double px,
            double py,
            double ax,
            double ay,
            double bx,
            double by)
        {
            double dx = bx - ax;
            double dy = by - ay;
            double lengthSquared = dx * dx + dy * dy;
            if (lengthSquared <= 1e-24)
            {
                dx = px - ax;
                dy = py - ay;
                return Math.Sqrt(dx * dx + dy * dy);
            }
            double projection = ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
            projection = Math.Max(0, Math.Min(1, projection));
            double x = ax + projection * dx;
            double y = ay + projection * dy;
            dx = px - x;
            dy = py - y;
            return Math.Sqrt(dx * dx + dy * dy);
        }

        static bool HasPoint(double[] point)
        {
            return point != null
                && point.Length >= 2
                && Finite(point[0])
                && Finite(point[1]);
        }

        static bool Finite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }

        static string StableSegmentId(string tableId, string groupId)
        {
            return (tableId ?? "") + "/" + (groupId ?? "");
        }

        static void ValidateConfig(BomInstanceCoverageConfig config)
        {
            if (config.MaximumInstanceDetails <= 0)
            {
                throw new ArgumentOutOfRangeException("MaximumInstanceDetails");
            }
            if (!Finite(config.ExplicitAnchorDistanceTolerance)
                || config.ExplicitAnchorDistanceTolerance < 0)
            {
                throw new ArgumentOutOfRangeException("ExplicitAnchorDistanceTolerance");
            }
            if (!Finite(config.AnchorDistanceDrawingDiagonalRatio)
                || config.AnchorDistanceDrawingDiagonalRatio <= 0)
            {
                throw new ArgumentOutOfRangeException("AnchorDistanceDrawingDiagonalRatio");
            }
            if (!Finite(config.AnchorDistanceMedianLeafSpanMultiplier)
                || config.AnchorDistanceMedianLeafSpanMultiplier <= 0)
            {
                throw new ArgumentOutOfRangeException("AnchorDistanceMedianLeafSpanMultiplier");
            }
            if (!Finite(config.MinimumAnchorDistanceTolerance)
                || config.MinimumAnchorDistanceTolerance <= 0)
            {
                throw new ArgumentOutOfRangeException("MinimumAnchorDistanceTolerance");
            }
        }
    }

    internal static class BomInstanceCoverageMaps
    {
        public static Dictionary<string, object> Map(params object[] pairs)
        {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            for (int index = 0; index + 1 < pairs.Length; index += 2)
            {
                result[Convert.ToString(pairs[index], CultureInfo.InvariantCulture)] =
                    pairs[index + 1];
            }
            return result;
        }
    }
}
