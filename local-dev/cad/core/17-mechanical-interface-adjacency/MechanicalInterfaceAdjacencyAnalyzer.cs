using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace Shb.Cad.Core
{
    public sealed class MechanicalInterfaceAdjacencyConfig
    {
        public MechanicalInterfaceAdjacencyConfig()
        {
            CenterToleranceRatio = 0.00001;
            TerminalBoundaryToleranceRatio = 0.000005;
            MinimumNestedSizeSeparationRatio = 0.01;
            AngularToleranceDegrees = 3.0;
            MaximumFeatureCount = 100000;
            MaximumPatternCount = 200000;
            MaximumAdjacencyCount = 250000;
            MaximumTerminalMatchesPerEndpoint = 8;
            MaximumIndexCellsPerSegment = 4096;
        }

        public double CenterToleranceRatio { get; set; }
        public double TerminalBoundaryToleranceRatio { get; set; }
        public double MinimumNestedSizeSeparationRatio { get; set; }
        public double AngularToleranceDegrees { get; set; }
        public int MaximumFeatureCount { get; set; }
        public int MaximumPatternCount { get; set; }
        public int MaximumAdjacencyCount { get; set; }
        public int MaximumTerminalMatchesPerEndpoint { get; set; }
        public int MaximumIndexCellsPerSegment { get; set; }
    }

    public sealed class MechanicalInterfaceFeatureRecord
    {
        readonly List<string> boundaryEdgeIds;
        readonly List<string> sourceOccurrenceIds;
        readonly List<string> sourceHandles;

        internal MechanicalInterfaceFeatureRecord(
            string id,
            string sourceVoidBoundaryId,
            string hostProfileId,
            string boundaryProfileId,
            string regionId,
            string objectClusterId,
            string featureKind,
            string shapeClass,
            string status,
            double centerX,
            double centerY,
            double orientedWidth,
            double orientedHeight,
            double orientationDegrees,
            double area,
            IEnumerable<string> edges,
            IEnumerable<string> occurrences,
            IEnumerable<string> handles)
        {
            Id = id ?? "";
            SourceVoidBoundaryId = sourceVoidBoundaryId ?? "";
            HostProfileId = hostProfileId ?? "";
            BoundaryProfileId = boundaryProfileId ?? "";
            RegionId = regionId ?? "";
            PhysicalObjectClusterId = objectClusterId ?? "";
            FeatureKind = featureKind ?? "nested_interface_geometry_candidate";
            ShapeClass = shapeClass ?? "irregular_closed_profile";
            Status = status ?? "geometry_candidate_only";
            CenterX = centerX;
            CenterY = centerY;
            OrientedWidth = orientedWidth;
            OrientedHeight = orientedHeight;
            OrientationDegrees = orientationDegrees;
            Area = area;
            boundaryEdgeIds = InterfaceAdjacencyMaps.SortedUnique(edges);
            sourceOccurrenceIds = InterfaceAdjacencyMaps.SortedUnique(occurrences);
            sourceHandles = InterfaceAdjacencyMaps.SortedUnique(handles);
        }

        public string Id { get; private set; }
        public string SourceVoidBoundaryId { get; private set; }
        public string HostProfileId { get; private set; }
        public string BoundaryProfileId { get; private set; }
        public string RegionId { get; private set; }
        public string PhysicalObjectClusterId { get; private set; }
        public string FeatureKind { get; private set; }
        public string ShapeClass { get; private set; }
        public string Status { get; private set; }
        public double CenterX { get; private set; }
        public double CenterY { get; private set; }
        public double OrientedWidth { get; private set; }
        public double OrientedHeight { get; private set; }
        public double OrientationDegrees { get; private set; }
        public double Area { get; private set; }
        public double NominalMinimumSize { get { return Math.Min(OrientedWidth, OrientedHeight); } }
        public double NominalMaximumSize { get { return Math.Max(OrientedWidth, OrientedHeight); } }
        public double AreaEquivalentDiameter
        {
            get { return Area <= 0 ? 0 : 2.0 * Math.Sqrt(Area / Math.PI); }
        }
        public IList<string> BoundaryEdgeIds { get { return boundaryEdgeIds.AsReadOnly(); } }
        public IList<string> SourceOccurrenceIds { get { return sourceOccurrenceIds.AsReadOnly(); } }
        public IList<string> SourceHandles { get { return sourceHandles.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return InterfaceAdjacencyMaps.Map(
                "interface_feature_id", Id,
                "source_void_boundary_id", SourceVoidBoundaryId,
                "host_profile_id", HostProfileId,
                "boundary_profile_id", BoundaryProfileId,
                "region_id", RegionId,
                "physical_object_cluster_id", PhysicalObjectClusterId,
                "feature_kind", FeatureKind,
                "shape_class", ShapeClass,
                "status", Status,
                "center", new[] { CenterX, CenterY },
                "oriented_extents", new[] { OrientedWidth, OrientedHeight },
                "orientation_degrees", OrientationDegrees,
                "area", Area,
                "nominal_minimum_size", NominalMinimumSize,
                "nominal_maximum_size", NominalMaximumSize,
                "area_equivalent_diameter", AreaEquivalentDiameter,
                "boundary_edge_ids", new List<string>(boundaryEdgeIds),
                "source_occurrence_ids", new List<string>(sourceOccurrenceIds),
                "source_handles", new List<string>(sourceHandles),
                "semantic_boundary", "nested_geometry_candidate_not_hole_port_or_mating_feature_proof");
        }
    }

    public sealed class MechanicalInterfacePatternRecord
    {
        readonly List<string> featureIds;
        readonly List<string> profileIds;
        readonly List<string> sourceIds;
        readonly List<double> spacings;

        internal MechanicalInterfacePatternRecord(
            string id,
            string kind,
            string regionId,
            string objectClusterId,
            string evidenceGrade,
            string status,
            string alignment,
            IEnumerable<string> features,
            IEnumerable<string> profiles,
            IEnumerable<string> sources,
            IEnumerable<double> spacingValues,
            double? centerResidual,
            double? tolerance,
            double? clearance,
            double? sizeRatio,
            double? angularResidual)
        {
            Id = id ?? "";
            Kind = kind ?? "interface_pattern_candidate";
            RegionId = regionId ?? "";
            PhysicalObjectClusterId = objectClusterId ?? "";
            EvidenceGrade = evidenceGrade ?? "geometry_only";
            Status = status ?? "candidate_not_connection_proof";
            Alignment = alignment ?? "";
            featureIds = InterfaceAdjacencyMaps.SortedUnique(features);
            profileIds = InterfaceAdjacencyMaps.SortedUnique(profiles);
            sourceIds = InterfaceAdjacencyMaps.SortedUnique(sources);
            spacings = spacingValues == null
                ? new List<double>()
                : spacingValues.OrderBy(value => value).ToList();
            CenterResidual = centerResidual;
            Tolerance = tolerance;
            Clearance = clearance;
            SizeRatio = sizeRatio;
            AngularResidualDegrees = angularResidual;
        }

        public string Id { get; private set; }
        public string Kind { get; private set; }
        public string RegionId { get; private set; }
        public string PhysicalObjectClusterId { get; private set; }
        public string EvidenceGrade { get; private set; }
        public string Status { get; private set; }
        public string Alignment { get; private set; }
        public IList<string> FeatureIds { get { return featureIds.AsReadOnly(); } }
        public IList<string> ProfileIds { get { return profileIds.AsReadOnly(); } }
        public IList<string> SourceIds { get { return sourceIds.AsReadOnly(); } }
        public IList<double> Spacings { get { return spacings.AsReadOnly(); } }
        public double? CenterResidual { get; private set; }
        public double? Tolerance { get; private set; }
        public double? Clearance { get; private set; }
        public double? SizeRatio { get; private set; }
        public double? AngularResidualDegrees { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return InterfaceAdjacencyMaps.Map(
                "interface_pattern_id", Id,
                "kind", Kind,
                "region_id", RegionId,
                "physical_object_cluster_id", PhysicalObjectClusterId,
                "evidence_grade", EvidenceGrade,
                "status", Status,
                "alignment", Alignment,
                "feature_ids", new List<string>(featureIds),
                "profile_ids", new List<string>(profileIds),
                "source_ids", new List<string>(sourceIds),
                "spacings", new List<double>(spacings),
                "center_residual", InterfaceAdjacencyMaps.Nullable(CenterResidual),
                "tolerance", InterfaceAdjacencyMaps.Nullable(Tolerance),
                "clearance", InterfaceAdjacencyMaps.Nullable(Clearance),
                "size_ratio", InterfaceAdjacencyMaps.Nullable(SizeRatio),
                "angular_residual_degrees", InterfaceAdjacencyMaps.Nullable(AngularResidualDegrees),
                "semantic_boundary", "projected_interface_pattern_not_3d_fit_fastener_or_connection_proof");
        }
    }

    public sealed class MechanicalAdjacencyEvidenceRecord
    {
        readonly List<string> edgeIds;
        readonly List<string> sourceOccurrenceIds;
        readonly List<string> sourceHandles;
        readonly List<string> sourceIds;

        internal MechanicalAdjacencyEvidenceRecord(
            string id,
            string kind,
            string regionId,
            string objectClusterId,
            string leftProfileId,
            string rightProfileId,
            string openBoundaryId,
            string endpointVertexId,
            string evidenceGrade,
            string status,
            IEnumerable<string> edges,
            IEnumerable<string> occurrences,
            IEnumerable<string> handles,
            IEnumerable<string> sources,
            double? sharedLength,
            double? gap,
            double? tolerance)
        {
            Id = id ?? "";
            Kind = kind ?? "drawing_adjacency_observation";
            RegionId = regionId ?? "";
            PhysicalObjectClusterId = objectClusterId ?? "";
            LeftProfileId = leftProfileId ?? "";
            RightProfileId = rightProfileId ?? "";
            OpenBoundaryId = openBoundaryId ?? "";
            EndpointVertexId = endpointVertexId ?? "";
            EvidenceGrade = evidenceGrade ?? "topology_only";
            Status = status ?? "not_physical_contact_proof";
            edgeIds = InterfaceAdjacencyMaps.SortedUnique(edges);
            sourceOccurrenceIds = InterfaceAdjacencyMaps.SortedUnique(occurrences);
            sourceHandles = InterfaceAdjacencyMaps.SortedUnique(handles);
            sourceIds = InterfaceAdjacencyMaps.SortedUnique(sources);
            SharedLength = sharedLength;
            Gap = gap;
            Tolerance = tolerance;
        }

        public string Id { get; private set; }
        public string Kind { get; private set; }
        public string RegionId { get; private set; }
        public string PhysicalObjectClusterId { get; private set; }
        public string LeftProfileId { get; private set; }
        public string RightProfileId { get; private set; }
        public string OpenBoundaryId { get; private set; }
        public string EndpointVertexId { get; private set; }
        public string EvidenceGrade { get; private set; }
        public string Status { get; private set; }
        public IList<string> EdgeIds { get { return edgeIds.AsReadOnly(); } }
        public IList<string> SourceOccurrenceIds { get { return sourceOccurrenceIds.AsReadOnly(); } }
        public IList<string> SourceHandles { get { return sourceHandles.AsReadOnly(); } }
        public IList<string> SourceIds { get { return sourceIds.AsReadOnly(); } }
        public double? SharedLength { get; private set; }
        public double? Gap { get; private set; }
        public double? Tolerance { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return InterfaceAdjacencyMaps.Map(
                "adjacency_evidence_id", Id,
                "kind", Kind,
                "region_id", RegionId,
                "physical_object_cluster_id", PhysicalObjectClusterId,
                "left_profile_id", LeftProfileId,
                "right_profile_id", RightProfileId,
                "open_boundary_id", OpenBoundaryId,
                "endpoint_vertex_id", EndpointVertexId,
                "evidence_grade", EvidenceGrade,
                "status", Status,
                "edge_ids", new List<string>(edgeIds),
                "source_occurrence_ids", new List<string>(sourceOccurrenceIds),
                "source_handles", new List<string>(sourceHandles),
                "source_ids", new List<string>(sourceIds),
                "shared_length", InterfaceAdjacencyMaps.Nullable(SharedLength),
                "gap", InterfaceAdjacencyMaps.Nullable(Gap),
                "tolerance", InterfaceAdjacencyMaps.Nullable(Tolerance),
                "semantic_boundary", "drawing_geometry_adjacency_not_physical_contact_or_defect_proof");
        }
    }

    public sealed class MechanicalObjectInterfaceSummaryRecord
    {
        readonly List<string> representationIds;
        readonly List<string> regionIds;
        readonly List<string> featureIds;
        readonly List<string> patternIds;
        readonly List<string> adjacencyEvidenceIds;

        internal MechanicalObjectInterfaceSummaryRecord(
            string clusterId,
            IEnumerable<string> representations,
            IEnumerable<string> regions,
            IEnumerable<string> features,
            IEnumerable<string> patterns,
            IEnumerable<string> adjacencies)
        {
            PhysicalObjectClusterId = clusterId ?? "";
            representationIds = InterfaceAdjacencyMaps.SortedUnique(representations);
            regionIds = InterfaceAdjacencyMaps.SortedUnique(regions);
            featureIds = InterfaceAdjacencyMaps.SortedUnique(features);
            patternIds = InterfaceAdjacencyMaps.SortedUnique(patterns);
            adjacencyEvidenceIds = InterfaceAdjacencyMaps.SortedUnique(adjacencies);
        }

        public string PhysicalObjectClusterId { get; private set; }
        public IList<string> RepresentationIds { get { return representationIds.AsReadOnly(); } }
        public IList<string> RegionIds { get { return regionIds.AsReadOnly(); } }
        public IList<string> FeatureIds { get { return featureIds.AsReadOnly(); } }
        public IList<string> PatternIds { get { return patternIds.AsReadOnly(); } }
        public IList<string> AdjacencyEvidenceIds { get { return adjacencyEvidenceIds.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return InterfaceAdjacencyMaps.Map(
                "physical_object_cluster_id", PhysicalObjectClusterId,
                "representation_ids", new List<string>(representationIds),
                "region_ids", new List<string>(regionIds),
                "interface_feature_ids", new List<string>(featureIds),
                "interface_pattern_ids", new List<string>(patternIds),
                "adjacency_evidence_ids", new List<string>(adjacencyEvidenceIds),
                "cross_view_status", "identity_index_only_no_projected_geometry_fusion");
        }
    }

    public sealed class MechanicalInterfaceAdjacencyDiagnosticRecord
    {
        internal MechanicalInterfaceAdjacencyDiagnosticRecord(
            string code,
            string status,
            string sourceId,
            string message)
        {
            Code = code ?? "";
            Status = status ?? "ambiguous";
            SourceId = sourceId ?? "";
            Message = message ?? "";
        }

        public string Code { get; private set; }
        public string Status { get; private set; }
        public string SourceId { get; private set; }
        public string Message { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return InterfaceAdjacencyMaps.Map(
                "code", Code,
                "status", Status,
                "source_id", SourceId,
                "message", Message);
        }
    }

    public sealed class MechanicalInterfaceAdjacencyDocument
    {
        readonly List<MechanicalInterfaceFeatureRecord> features;
        readonly List<MechanicalInterfacePatternRecord> patterns;
        readonly List<MechanicalAdjacencyEvidenceRecord> adjacencies;
        readonly List<MechanicalObjectInterfaceSummaryRecord> objectSummaries;
        readonly List<MechanicalInterfaceAdjacencyDiagnosticRecord> diagnostics;

        internal MechanicalInterfaceAdjacencyDocument(
            string drawingId,
            string regionStatus,
            string topologyStatus,
            string manufacturingStatus,
            string identityStatus,
            int inputFeatureCount,
            IEnumerable<MechanicalInterfaceFeatureRecord> featureValues,
            IEnumerable<MechanicalInterfacePatternRecord> patternValues,
            IEnumerable<MechanicalAdjacencyEvidenceRecord> adjacencyValues,
            IEnumerable<MechanicalObjectInterfaceSummaryRecord> summaryValues,
            IEnumerable<MechanicalInterfaceAdjacencyDiagnosticRecord> diagnosticValues)
        {
            DrawingId = drawingId ?? "";
            SourceRegionStatus = regionStatus ?? "";
            SourceTopologyStatus = topologyStatus ?? "";
            SourceManufacturingStatus = manufacturingStatus ?? "";
            SourceIdentityStatus = identityStatus ?? "";
            InputFeatureCandidateCount = inputFeatureCount;
            features = Copy(featureValues);
            patterns = Copy(patternValues);
            adjacencies = Copy(adjacencyValues);
            objectSummaries = Copy(summaryValues);
            diagnostics = Copy(diagnosticValues);
            bool unsupported = diagnostics.Any(value => value.Status == "unsupported")
                || SourceRegionStatus == "unsupported_partial"
                || SourceTopologyStatus == "unsupported_partial"
                || SourceManufacturingStatus == "unsupported_partial"
                || SourceIdentityStatus == "unsupported_partial";
            bool ambiguous = diagnostics.Any(value => value.Status == "ambiguous")
                || SourceRegionStatus == "ambiguous"
                || SourceTopologyStatus == "ambiguous"
                || SourceManufacturingStatus == "ambiguous"
                || SourceIdentityStatus == "ambiguous";
            Status = unsupported ? "unsupported_partial" : ambiguous ? "ambiguous" : "computed";
        }

        public string DrawingId { get; private set; }
        public string Status { get; private set; }
        public string SourceRegionStatus { get; private set; }
        public string SourceTopologyStatus { get; private set; }
        public string SourceManufacturingStatus { get; private set; }
        public string SourceIdentityStatus { get; private set; }
        public int InputFeatureCandidateCount { get; private set; }
        public int UnresolvedFeatureCandidateCount
        {
            get { return Math.Max(0, InputFeatureCandidateCount - features.Count); }
        }
        public IList<MechanicalInterfaceFeatureRecord> Features { get { return features.AsReadOnly(); } }
        public IList<MechanicalInterfacePatternRecord> Patterns { get { return patterns.AsReadOnly(); } }
        public IList<MechanicalAdjacencyEvidenceRecord> Adjacencies { get { return adjacencies.AsReadOnly(); } }
        public IList<MechanicalObjectInterfaceSummaryRecord> ObjectSummaries { get { return objectSummaries.AsReadOnly(); } }
        public IList<MechanicalInterfaceAdjacencyDiagnosticRecord> Diagnostics { get { return diagnostics.AsReadOnly(); } }
        public int CircularFeatureCount
        {
            get { return features.Count(value => value.ShapeClass == "circular_closed_profile"); }
        }
        public int CoaxialPatternCount
        {
            get { return patterns.Count(value => value.Kind == "coaxial_circular_feature_stack_candidate"); }
        }
        public int AlignedNestedPatternCount
        {
            get { return patterns.Count(value => value.Kind == "aligned_nested_feature_stack_candidate"); }
        }
        public int RepeatedPatternCount
        {
            get { return patterns.Count(value => value.Kind == "repeated_circular_interface_pattern_candidate"
                || value.Kind == "repeated_interface_pattern_candidate"); }
        }
        public int CoincidentBoundaryCount
        {
            get { return adjacencies.Count(value => value.Kind == "coincident_multi_source_boundary_candidate"); }
        }
        public int TerminalApproachCount
        {
            get { return adjacencies.Count(value => value.Kind == "open_terminal_near_profile_boundary_candidate"); }
        }

        public Dictionary<string, object> ToMap()
        {
            return InterfaceAdjacencyMaps.Map(
                "schema_version", "1",
                "analysis_type", "mechanical_interface_adjacency",
                "analyzer_version", "1",
                "drawing_id", DrawingId,
                "status", Status,
                "source_region_status", SourceRegionStatus,
                "source_topology_status", SourceTopologyStatus,
                "source_manufacturing_status", SourceManufacturingStatus,
                "source_identity_status", SourceIdentityStatus,
                "input_feature_candidate_count", InputFeatureCandidateCount,
                "interface_feature_candidate_count", features.Count,
                "unresolved_feature_candidate_count", UnresolvedFeatureCandidateCount,
                "circular_feature_candidate_count", CircularFeatureCount,
                "interface_pattern_count", patterns.Count,
                "coaxial_pattern_candidate_count", CoaxialPatternCount,
                "aligned_nested_pattern_candidate_count", AlignedNestedPatternCount,
                "repeated_pattern_candidate_count", RepeatedPatternCount,
                "adjacency_evidence_count", adjacencies.Count,
                "coincident_multi_source_boundary_candidate_count", CoincidentBoundaryCount,
                "open_terminal_approach_candidate_count", TerminalApproachCount,
                "object_summary_count", objectSummaries.Count,
                "features", features.Select(value => value.ToMap()).ToList(),
                "patterns", patterns.Select(value => value.ToMap()).ToList(),
                "adjacency_evidence", adjacencies.Select(value => value.ToMap()).ToList(),
                "object_summaries", objectSummaries.Select(value => value.ToMap()).ToList(),
                "diagnostics", diagnostics.Select(value => value.ToMap()).ToList(),
                "semantic_contract", InterfaceAdjacencyMaps.Map(
                    "nested_feature", "candidate_not_hole_port_or_mating_feature_proof",
                    "coaxial_pattern", "2d_concentric_geometry_not_3d_axis_fit_or_tolerance_proof",
                    "repeated_pattern", "geometry_repetition_not_fastener_connection_or_quantity_proof",
                    "shared_boundary", "dcel_face_adjacency_not_physical_contact_proof",
                    "coincident_support", "multiple_drawing_sources_not_mated_part_proof",
                    "terminal_approach", "near_endpoint_not_connection_gap_or_defect_proof",
                    "cross_view", "identity_index_only_no_geometry_fusion"),
                "mutation_status", "read_only_no_entities_modified");
        }

        public string ToMarkdown()
        {
            var builder = new StringBuilder();
            builder.AppendLine("# 机械接口与装配邻接候选");
            builder.AppendLine();
            builder.AppendLine("- 图纸：`" + DrawingId + "`");
            builder.AppendLine("- 状态：`" + Status + "`（源制造轮廓：`" + SourceManufacturingStatus + "`）");
            builder.AppendLine("- 接口特征候选 / 圆形候选："
                + features.Count.ToString(CultureInfo.InvariantCulture)
                + " / " + CircularFeatureCount.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine("- 同轴 / 对齐嵌套 / 重复模式："
                + CoaxialPatternCount.ToString(CultureInfo.InvariantCulture)
                + " / " + AlignedNestedPatternCount.ToString(CultureInfo.InvariantCulture)
                + " / " + RepeatedPatternCount.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine("- 邻接证据 / 多源重合边 / 开放端近接："
                + adjacencies.Count.ToString(CultureInfo.InvariantCulture)
                + " / " + CoincidentBoundaryCount.ToString(CultureInfo.InvariantCulture)
                + " / " + TerminalApproachCount.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine();
            builder.AppendLine("所有结果都停留在二维图面证据层；同心、重复、共边、重合线和近接端点均不自动证明真实孔、法兰、螺栓、配合、物理接触或绘图缺陷。");
            return builder.ToString().TrimEnd();
        }

        static List<T> Copy<T>(IEnumerable<T> values)
        {
            return values == null ? new List<T>() : values.ToList();
        }
    }

    public static class MechanicalInterfaceAdjacencyAnalyzer
    {
        sealed class FeatureBuilder
        {
            public ManufacturingVoidBoundaryRecord Source;
            public MechanicalInterfaceFeatureRecord Record;
        }

        sealed class BoundarySegmentReference
        {
            public string Key;
            public string ProfileId;
            public string EdgeId;
            public double StartX;
            public double StartY;
            public double EndX;
            public double EndY;
        }

        sealed class BoundaryHit
        {
            public BoundarySegmentReference Segment;
            public double Distance;
        }

        sealed class BoundarySpatialIndex
        {
            readonly double cellSize;
            readonly int maximumCellsPerSegment;
            readonly Dictionary<string, List<BoundarySegmentReference>> cells;
            readonly List<BoundarySegmentReference> broadSegments;

            public BoundarySpatialIndex(double requestedCellSize, int maxCells)
            {
                cellSize = Math.Max(requestedCellSize, 0.000000001);
                maximumCellsPerSegment = Math.Max(1, maxCells);
                cells = new Dictionary<string, List<BoundarySegmentReference>>(StringComparer.Ordinal);
                broadSegments = new List<BoundarySegmentReference>();
            }

            public void Add(BoundarySegmentReference value)
            {
                long minX = Cell(Math.Min(value.StartX, value.EndX));
                long maxX = Cell(Math.Max(value.StartX, value.EndX));
                long minY = Cell(Math.Min(value.StartY, value.EndY));
                long maxY = Cell(Math.Max(value.StartY, value.EndY));
                long countX = Math.Max(1, maxX - minX + 1);
                long countY = Math.Max(1, maxY - minY + 1);
                if (countX > maximumCellsPerSegment
                    || countY > maximumCellsPerSegment
                    || countX * countY > maximumCellsPerSegment)
                {
                    broadSegments.Add(value);
                    return;
                }
                for (long x = minX; x <= maxX; x++)
                {
                    for (long y = minY; y <= maxY; y++)
                    {
                        string key = CellKey(x, y);
                        List<BoundarySegmentReference> values;
                        if (!cells.TryGetValue(key, out values))
                        {
                            values = new List<BoundarySegmentReference>();
                            cells[key] = values;
                        }
                        values.Add(value);
                    }
                }
            }

            public List<BoundarySegmentReference> Query(double x, double y)
            {
                long centerX = Cell(x);
                long centerY = Cell(y);
                var result = new List<BoundarySegmentReference>();
                var seen = new HashSet<string>(StringComparer.Ordinal);
                for (long offsetX = -1; offsetX <= 1; offsetX++)
                {
                    for (long offsetY = -1; offsetY <= 1; offsetY++)
                    {
                        List<BoundarySegmentReference> values;
                        if (!cells.TryGetValue(CellKey(centerX + offsetX, centerY + offsetY), out values))
                        {
                            continue;
                        }
                        foreach (BoundarySegmentReference value in values)
                        {
                            if (seen.Add(value.Key)) { result.Add(value); }
                        }
                    }
                }
                foreach (BoundarySegmentReference value in broadSegments)
                {
                    if (seen.Add(value.Key)) { result.Add(value); }
                }
                return result;
            }

            long Cell(double value)
            {
                return (long)Math.Floor(value / cellSize);
            }

            static string CellKey(long x, long y)
            {
                return x.ToString(CultureInfo.InvariantCulture) + "\u001f"
                    + y.ToString(CultureInfo.InvariantCulture);
            }
        }

        public static MechanicalInterfaceAdjacencyDocument Analyze(
            EngineeringViewRegionDocument regions,
            PlanarTopologyDocument topology,
            RepresentationIdentityResolutionDocument identity,
            ManufacturingProfileFeatureDocument manufacturing,
            MechanicalInterfaceAdjacencyConfig config = null)
        {
            if (regions == null) { throw new ArgumentNullException("regions"); }
            if (topology == null) { throw new ArgumentNullException("topology"); }
            if (identity == null) { throw new ArgumentNullException("identity"); }
            if (manufacturing == null) { throw new ArgumentNullException("manufacturing"); }
            config = config ?? new MechanicalInterfaceAdjacencyConfig();
            ValidateConfig(config);

            var diagnostics = new List<MechanicalInterfaceAdjacencyDiagnosticRecord>();
            if (!SameDrawing(regions.DrawingId, topology.DrawingId)
                || !SameDrawing(regions.DrawingId, identity.DrawingId)
                || !SameDrawing(regions.DrawingId, manufacturing.DrawingId))
            {
                diagnostics.Add(new MechanicalInterfaceAdjacencyDiagnosticRecord(
                    "DRAWING_ID_MISMATCH", "unsupported", regions.DrawingId,
                    "Region, topology, identity, and manufacturing documents must describe the same drawing."));
            }

            var regionById = regions.Regions.Where(value => value != null && value.IsEngineeringView)
                .ToDictionary(value => value.Id, value => value, StringComparer.Ordinal);
            var vertexById = topology.Vertices.ToDictionary(value => value.Id, value => value, StringComparer.Ordinal);
            var edgeById = topology.Edges.ToDictionary(value => value.Id, value => value, StringComparer.Ordinal);
            var profileById = manufacturing.Profiles.ToDictionary(value => value.Id, value => value, StringComparer.Ordinal);

            var featureBuilders = new List<FeatureBuilder>();
            bool featureLimitReached = false;
            foreach (ManufacturingVoidBoundaryRecord source in manufacturing.VoidBoundaries
                .OrderBy(value => value.Id, StringComparer.Ordinal))
            {
                if (featureBuilders.Count >= config.MaximumFeatureCount)
                {
                    featureLimitReached = true;
                    break;
                }
                MechanicalInterfaceFeatureRecord record = new MechanicalInterfaceFeatureRecord(
                    "mechanical-interface-feature:" + Hash(new[] { regions.DrawingId, source.Id }),
                    source.Id,
                    source.HostProfileId,
                    source.BoundaryProfileId,
                    source.RegionId,
                    source.PhysicalObjectClusterId,
                    FeatureKind(source.ShapeClass),
                    source.ShapeClass,
                    source.Status,
                    source.CenterX,
                    source.CenterY,
                    source.OrientedWidth,
                    source.OrientedHeight,
                    source.OrientationDegrees,
                    source.Area,
                    source.BoundaryEdgeIds,
                    source.SourceOccurrenceIds,
                    source.SourceHandles);
                featureBuilders.Add(new FeatureBuilder { Source = source, Record = record });
            }
            if (featureLimitReached)
            {
                diagnostics.Add(new MechanicalInterfaceAdjacencyDiagnosticRecord(
                    "INTERFACE_FEATURE_LIMIT_REACHED", "unsupported", "",
                    "Interface feature candidates were truncated at the configured limit."));
            }

            var featureByVoidId = featureBuilders.ToDictionary(
                value => value.Source.Id, value => value, StringComparer.Ordinal);
            var patterns = new List<MechanicalInterfacePatternRecord>();
            bool patternLimitReached = false;
            foreach (FeatureBuilder feature in featureBuilders.OrderBy(value => value.Record.Id, StringComparer.Ordinal))
            {
                if (!TryAddPattern(
                    patterns,
                    config.MaximumPatternCount,
                    new MechanicalInterfacePatternRecord(
                        "mechanical-interface-pattern:" + Hash(new[] { "encloses", feature.Record.Id }),
                        "profile_encloses_interface_feature_candidate",
                        feature.Record.RegionId,
                        feature.Record.PhysicalObjectClusterId,
                        "dcel_hole_hierarchy",
                        "nested_geometry_not_opening_or_connection_proof",
                        "",
                        new[] { feature.Record.Id },
                        new[] { feature.Record.HostProfileId, feature.Record.BoundaryProfileId },
                        new[] { feature.Record.SourceVoidBoundaryId },
                        null, null, null, null, null, null)))
                {
                    patternLimitReached = true;
                    break;
                }
            }

            if (!patternLimitReached)
            {
                foreach (RepeatedManufacturingFeatureGroupRecord group in manufacturing.RepeatedFeatureGroups
                    .OrderBy(value => value.Id, StringComparer.Ordinal))
                {
                    List<FeatureBuilder> members = group.FeatureIds.Where(featureByVoidId.ContainsKey)
                        .Select(value => featureByVoidId[value]).OrderBy(value => value.Record.Id, StringComparer.Ordinal).ToList();
                    if (members.Count < 2) { continue; }
                    string kind = members.All(value => value.Record.ShapeClass == "circular_closed_profile")
                        ? "repeated_circular_interface_pattern_candidate"
                        : "repeated_interface_pattern_candidate";
                    if (!TryAddPattern(
                        patterns,
                        config.MaximumPatternCount,
                        new MechanicalInterfacePatternRecord(
                            "mechanical-interface-pattern:" + Hash(new[] { "repeat", group.Id }),
                            kind,
                            group.RegionId,
                            group.PhysicalObjectClusterId,
                            "repeated_geometry",
                            "pattern_not_fastener_connection_or_quantity_proof",
                            group.Alignment,
                            members.Select(value => value.Record.Id),
                            members.SelectMany(value => new[]
                            {
                                value.Record.HostProfileId,
                                value.Record.BoundaryProfileId
                            }),
                            new[] { group.Id },
                            group.ConsecutiveSpacings,
                            null, null, null, null, null)))
                    {
                        patternLimitReached = true;
                        break;
                    }
                }
            }

            if (!patternLimitReached)
            {
                var featuresByHostProfile = featureBuilders.Where(value => !string.IsNullOrEmpty(value.Record.HostProfileId))
                    .GroupBy(value => value.Record.HostProfileId, StringComparer.Ordinal)
                    .ToDictionary(group => group.Key, group => group.ToList(), StringComparer.Ordinal);
                foreach (FeatureBuilder outer in featureBuilders.OrderBy(value => value.Record.Id, StringComparer.Ordinal))
                {
                    if (string.IsNullOrEmpty(outer.Record.BoundaryProfileId)) { continue; }
                    List<FeatureBuilder> children;
                    if (!featuresByHostProfile.TryGetValue(outer.Record.BoundaryProfileId, out children)) { continue; }
                    EngineeringViewRegionRecord region;
                    if (!regionById.TryGetValue(outer.Record.RegionId, out region)) { continue; }
                    double tolerance = CenterTolerance(region, topology, config);
                    foreach (FeatureBuilder inner in children.OrderBy(value => value.Record.Id, StringComparer.Ordinal))
                    {
                        if (outer.Record.Id == inner.Record.Id || outer.Record.RegionId != inner.Record.RegionId) { continue; }
                        double residual = Distance(
                            outer.Record.CenterX, outer.Record.CenterY,
                            inner.Record.CenterX, inner.Record.CenterY);
                        if (residual > tolerance) { continue; }
                        double outerSize = outer.Record.NominalMinimumSize;
                        double innerSize = inner.Record.NominalMinimumSize;
                        if (outerSize <= 0 || innerSize <= 0) { continue; }
                        double maximum = Math.Max(outerSize, innerSize);
                        double minimum = Math.Min(outerSize, innerSize);
                        double sizeRatio = minimum / maximum;
                        if (1.0 - sizeRatio < config.MinimumNestedSizeSeparationRatio) { continue; }
                        string kind = "";
                        double? angularResidual = null;
                        if (outer.Record.ShapeClass == "circular_closed_profile"
                            && inner.Record.ShapeClass == "circular_closed_profile")
                        {
                            kind = "coaxial_circular_feature_stack_candidate";
                        }
                        else if (IsOrientedPrismatic(outer.Record.ShapeClass)
                            && IsOrientedPrismatic(inner.Record.ShapeClass))
                        {
                            double angle = OrientationResidual(
                                outer.Record.OrientationDegrees,
                                inner.Record.OrientationDegrees);
                            if (angle <= config.AngularToleranceDegrees)
                            {
                                kind = "aligned_nested_feature_stack_candidate";
                                angularResidual = angle;
                            }
                        }
                        if (string.IsNullOrEmpty(kind)) { continue; }
                        if (!TryAddPattern(
                            patterns,
                            config.MaximumPatternCount,
                            new MechanicalInterfacePatternRecord(
                                "mechanical-interface-pattern:" + Hash(new[] { kind, outer.Record.Id, inner.Record.Id }),
                                kind,
                                outer.Record.RegionId,
                                outer.Record.PhysicalObjectClusterId,
                                "nested_hierarchy_plus_center_alignment",
                                "projected_stack_not_3d_axis_fit_or_tolerance_proof",
                                "center_aligned_in_view_plane",
                                new[] { outer.Record.Id, inner.Record.Id },
                                new[]
                                {
                                    outer.Record.HostProfileId,
                                    outer.Record.BoundaryProfileId,
                                    inner.Record.BoundaryProfileId
                                },
                                new[] { outer.Record.SourceVoidBoundaryId, inner.Record.SourceVoidBoundaryId },
                                null,
                                residual,
                                tolerance,
                                Math.Max(0, (maximum - minimum) * 0.5),
                                sizeRatio,
                                angularResidual)))
                        {
                            patternLimitReached = true;
                            break;
                        }
                    }
                    if (patternLimitReached) { break; }
                }
            }
            if (patternLimitReached)
            {
                diagnostics.Add(new MechanicalInterfaceAdjacencyDiagnosticRecord(
                    "INTERFACE_PATTERN_LIMIT_REACHED", "unsupported", "",
                    "Interface pattern candidates were truncated at the configured limit."));
            }

            var adjacencies = new List<MechanicalAdjacencyEvidenceRecord>();
            bool adjacencyLimitReached = false;
            foreach (ManufacturingProfileAdjacencyRecord source in manufacturing.Adjacencies
                .Where(value => value.RelationType == "shares_topological_boundary")
                .OrderBy(value => value.Id, StringComparer.Ordinal))
            {
                if (adjacencies.Count >= config.MaximumAdjacencyCount)
                {
                    adjacencyLimitReached = true;
                    break;
                }
                ManufacturingProfileRecord left;
                ManufacturingProfileRecord right;
                if (!profileById.TryGetValue(source.LeftProfileId, out left)
                    || !profileById.TryGetValue(source.RightProfileId, out right))
                {
                    continue;
                }
                List<PlanarEdgeSupportRecord> supports = source.SharedEdgeIds.Where(edgeById.ContainsKey)
                    .SelectMany(value => edgeById[value].Supports).ToList();
                int distinctOccurrences = supports.Select(value => value.OccurrenceId)
                    .Where(value => !string.IsNullOrEmpty(value)).Distinct(StringComparer.Ordinal).Count();
                int distinctHandles = supports.Select(value => value.SourceHandle)
                    .Where(value => !string.IsNullOrEmpty(value)).Distinct(StringComparer.Ordinal).Count();
                bool multiSource = source.SharedEdgeIds.Where(edgeById.ContainsKey)
                    .Any(value => edgeById[value].HasCoincidentSupport)
                    && (distinctOccurrences > 1 || distinctHandles > 1);
                string kind = multiSource
                    ? "coincident_multi_source_boundary_candidate"
                    : "drawing_face_adjacency_observation";
                adjacencies.Add(new MechanicalAdjacencyEvidenceRecord(
                    "mechanical-adjacency-evidence:" + Hash(new[] { kind, source.Id }),
                    kind,
                    left.RegionId,
                    left.PhysicalObjectClusterId,
                    left.Id,
                    right.Id,
                    "",
                    "",
                    multiSource ? "multi_source_projected_geometry" : "dcel_topology_only",
                    multiSource
                        ? "coincident_sources_not_mated_part_proof"
                        : "face_adjacency_not_physical_contact_proof",
                    source.SharedEdgeIds,
                    supports.Select(value => value.OccurrenceId),
                    supports.Select(value => value.SourceHandle),
                    new[] { source.Id },
                    source.SharedBoundaryLength,
                    null,
                    null));
            }

            if (!adjacencyLimitReached)
            {
                BuildTerminalApproaches(
                    manufacturing,
                    topology,
                    regionById,
                    profileById,
                    vertexById,
                    edgeById,
                    config,
                    adjacencies,
                    diagnostics,
                    out adjacencyLimitReached);
            }
            if (adjacencyLimitReached)
            {
                diagnostics.Add(new MechanicalInterfaceAdjacencyDiagnosticRecord(
                    "ADJACENCY_EVIDENCE_LIMIT_REACHED", "unsupported", "",
                    "Mechanical adjacency evidence was truncated at the configured limit."));
            }

            List<MechanicalObjectInterfaceSummaryRecord> summaries = BuildObjectSummaries(
                identity,
                featureBuilders.Select(value => value.Record),
                patterns,
                adjacencies);
            return new MechanicalInterfaceAdjacencyDocument(
                regions.DrawingId,
                regions.Status,
                topology.Status,
                manufacturing.Status,
                identity.Status,
                manufacturing.VoidBoundaries.Count,
                featureBuilders.Select(value => value.Record).OrderBy(value => value.Id, StringComparer.Ordinal),
                patterns.OrderBy(value => value.Id, StringComparer.Ordinal),
                adjacencies.OrderBy(value => value.Id, StringComparer.Ordinal),
                summaries.OrderBy(value => value.PhysicalObjectClusterId, StringComparer.Ordinal),
                diagnostics);
        }

        static void BuildTerminalApproaches(
            ManufacturingProfileFeatureDocument manufacturing,
            PlanarTopologyDocument topology,
            IDictionary<string, EngineeringViewRegionRecord> regionById,
            IDictionary<string, ManufacturingProfileRecord> profileById,
            IDictionary<string, PlanarVertexRecord> vertexById,
            IDictionary<string, PlanarEdgeRecord> edgeById,
            MechanicalInterfaceAdjacencyConfig config,
            IList<MechanicalAdjacencyEvidenceRecord> result,
            IList<MechanicalInterfaceAdjacencyDiagnosticRecord> diagnostics,
            out bool limitReached)
        {
            limitReached = false;
            var profilesByRegion = manufacturing.Profiles.GroupBy(value => value.RegionId, StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.ToList(), StringComparer.Ordinal);
            var indexes = new Dictionary<string, BoundarySpatialIndex>(StringComparer.Ordinal);
            foreach (OpenManufacturingBoundaryRecord open in manufacturing.OpenBoundaries
                .OrderBy(value => value.Id, StringComparer.Ordinal))
            {
                EngineeringViewRegionRecord region;
                List<ManufacturingProfileRecord> regionProfiles;
                if (!regionById.TryGetValue(open.RegionId, out region)
                    || !profilesByRegion.TryGetValue(open.RegionId, out regionProfiles))
                {
                    continue;
                }
                double tolerance = TerminalTolerance(region, topology, config);
                BoundarySpatialIndex index;
                if (!indexes.TryGetValue(region.Id, out index))
                {
                    double scale = RegionScale(region, topology);
                    double cellSize = Math.Max(tolerance * 4.0, scale / 128.0);
                    index = BuildBoundaryIndex(
                        regionProfiles,
                        edgeById,
                        vertexById,
                        cellSize,
                        config.MaximumIndexCellsPerSegment);
                    indexes[region.Id] = index;
                }
                var openEdgeIds = new HashSet<string>(open.EdgeIds, StringComparer.Ordinal);
                List<PlanarVertexRecord> endpoints = vertexById.Values
                    .Where(value => value.ComponentId == open.ComponentId && value.Degree == 1)
                    .OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
                foreach (PlanarVertexRecord endpoint in endpoints)
                {
                    var bestByProfile = new Dictionary<string, BoundaryHit>(StringComparer.Ordinal);
                    foreach (BoundarySegmentReference segment in index.Query(endpoint.X, endpoint.Y))
                    {
                        if (openEdgeIds.Contains(segment.EdgeId)) { continue; }
                        double gap = PointSegmentDistance(
                            endpoint.X,
                            endpoint.Y,
                            segment.StartX,
                            segment.StartY,
                            segment.EndX,
                            segment.EndY);
                        if (gap > tolerance) { continue; }
                        BoundaryHit existing;
                        if (!bestByProfile.TryGetValue(segment.ProfileId, out existing)
                            || gap < existing.Distance - 0.000000000001
                            || (Math.Abs(gap - existing.Distance) <= 0.000000000001
                                && string.Compare(segment.EdgeId, existing.Segment.EdgeId, StringComparison.Ordinal) < 0))
                        {
                            bestByProfile[segment.ProfileId] = new BoundaryHit
                            {
                                Segment = segment,
                                Distance = gap
                            };
                        }
                    }
                    List<BoundaryHit> hits = bestByProfile.Values
                        .OrderBy(value => value.Distance)
                        .ThenBy(value => value.Segment.ProfileId, StringComparer.Ordinal)
                        .ThenBy(value => value.Segment.EdgeId, StringComparer.Ordinal).ToList();
                    if (hits.Count > config.MaximumTerminalMatchesPerEndpoint)
                    {
                        diagnostics.Add(new MechanicalInterfaceAdjacencyDiagnosticRecord(
                            "TERMINAL_PROFILE_MATCH_LIMIT_REACHED", "ambiguous", endpoint.Id,
                            "An open endpoint approaches more profile boundaries than the configured per-endpoint limit."));
                        hits = hits.Take(config.MaximumTerminalMatchesPerEndpoint).ToList();
                    }
                    foreach (BoundaryHit hit in hits)
                    {
                        if (result.Count >= config.MaximumAdjacencyCount)
                        {
                            limitReached = true;
                            return;
                        }
                        ManufacturingProfileRecord profile;
                        if (!profileById.TryGetValue(hit.Segment.ProfileId, out profile)) { continue; }
                        PlanarEdgeRecord edge;
                        edgeById.TryGetValue(hit.Segment.EdgeId, out edge);
                        List<PlanarEdgeSupportRecord> supports = edge == null
                            ? new List<PlanarEdgeSupportRecord>()
                            : edge.Supports.ToList();
                        result.Add(new MechanicalAdjacencyEvidenceRecord(
                            "mechanical-adjacency-evidence:" + Hash(new[]
                            {
                                "terminal", open.Id, endpoint.Id, hit.Segment.ProfileId, hit.Segment.EdgeId
                            }),
                            "open_terminal_near_profile_boundary_candidate",
                            open.RegionId,
                            open.PhysicalObjectClusterId,
                            profile.Id,
                            "",
                            open.Id,
                            endpoint.Id,
                            "near_endpoint_projected_geometry",
                            "near_endpoint_not_connection_gap_or_defect_proof",
                            new[] { hit.Segment.EdgeId },
                            open.SourceOccurrenceIds.Concat(supports.Select(value => value.OccurrenceId)),
                            open.SourceHandles.Concat(supports.Select(value => value.SourceHandle)),
                            new[] { open.Id, profile.Id },
                            null,
                            hit.Distance,
                            tolerance));
                    }
                }
            }
        }

        static BoundarySpatialIndex BuildBoundaryIndex(
            IEnumerable<ManufacturingProfileRecord> profiles,
            IDictionary<string, PlanarEdgeRecord> edgeById,
            IDictionary<string, PlanarVertexRecord> vertexById,
            double cellSize,
            int maximumCellsPerSegment)
        {
            var index = new BoundarySpatialIndex(cellSize, maximumCellsPerSegment);
            foreach (ManufacturingProfileRecord profile in profiles.OrderBy(value => value.Id, StringComparer.Ordinal))
            {
                foreach (string edgeId in profile.BoundaryEdgeIds.OrderBy(value => value, StringComparer.Ordinal))
                {
                    PlanarEdgeRecord edge;
                    PlanarVertexRecord start;
                    PlanarVertexRecord end;
                    if (!edgeById.TryGetValue(edgeId, out edge)
                        || !vertexById.TryGetValue(edge.StartVertexId, out start)
                        || !vertexById.TryGetValue(edge.EndVertexId, out end))
                    {
                        continue;
                    }
                    index.Add(new BoundarySegmentReference
                    {
                        Key = profile.Id + "\u001f" + edge.Id,
                        ProfileId = profile.Id,
                        EdgeId = edge.Id,
                        StartX = start.X,
                        StartY = start.Y,
                        EndX = end.X,
                        EndY = end.Y
                    });
                }
            }
            return index;
        }

        static List<MechanicalObjectInterfaceSummaryRecord> BuildObjectSummaries(
            RepresentationIdentityResolutionDocument identity,
            IEnumerable<MechanicalInterfaceFeatureRecord> features,
            IEnumerable<MechanicalInterfacePatternRecord> patterns,
            IEnumerable<MechanicalAdjacencyEvidenceRecord> adjacencies)
        {
            List<MechanicalInterfaceFeatureRecord> featureValues = features.ToList();
            List<MechanicalInterfacePatternRecord> patternValues = patterns.ToList();
            List<MechanicalAdjacencyEvidenceRecord> adjacencyValues = adjacencies.ToList();
            var representations = identity.Representations.ToDictionary(value => value.Id, value => value, StringComparer.Ordinal);
            var result = new List<MechanicalObjectInterfaceSummaryRecord>();
            foreach (ResolvedPhysicalObjectClusterRecord cluster in identity.PhysicalObjectClusters)
            {
                List<string> regions = cluster.RepresentationIds.Where(representations.ContainsKey)
                    .Select(value => representations[value].RegionId)
                    .Where(value => !string.IsNullOrEmpty(value)).ToList();
                result.Add(new MechanicalObjectInterfaceSummaryRecord(
                    cluster.Id,
                    cluster.RepresentationIds,
                    regions,
                    featureValues.Where(value => value.PhysicalObjectClusterId == cluster.Id).Select(value => value.Id),
                    patternValues.Where(value => value.PhysicalObjectClusterId == cluster.Id).Select(value => value.Id),
                    adjacencyValues.Where(value => value.PhysicalObjectClusterId == cluster.Id).Select(value => value.Id)));
            }
            return result;
        }

        static bool TryAddPattern(
            IList<MechanicalInterfacePatternRecord> values,
            int maximum,
            MechanicalInterfacePatternRecord value)
        {
            if (values.Count >= maximum) { return false; }
            values.Add(value);
            return true;
        }

        static string FeatureKind(string shapeClass)
        {
            if (shapeClass == "circular_closed_profile")
            {
                return "circular_nested_interface_feature_candidate";
            }
            if (shapeClass == "rectangular_closed_profile")
            {
                return "rectangular_nested_interface_feature_candidate";
            }
            if (shapeClass == "elongated_closed_profile")
            {
                return "elongated_nested_interface_feature_candidate";
            }
            return "irregular_nested_interface_feature_candidate";
        }

        static bool IsOrientedPrismatic(string shapeClass)
        {
            return shapeClass == "rectangular_closed_profile"
                || shapeClass == "elongated_closed_profile";
        }

        static double CenterTolerance(
            EngineeringViewRegionRecord region,
            PlanarTopologyDocument topology,
            MechanicalInterfaceAdjacencyConfig config)
        {
            return Math.Max(topology.GridSize * 2.0, RegionScale(region, topology) * config.CenterToleranceRatio);
        }

        static double TerminalTolerance(
            EngineeringViewRegionRecord region,
            PlanarTopologyDocument topology,
            MechanicalInterfaceAdjacencyConfig config)
        {
            return Math.Max(topology.GridSize * 2.0, RegionScale(region, topology) * config.TerminalBoundaryToleranceRatio);
        }

        static double RegionScale(EngineeringViewRegionRecord region, PlanarTopologyDocument topology)
        {
            double scale = Math.Max(region.Width, region.Height);
            if (region.LocalFrame != null) { scale = Math.Max(scale, region.LocalFrame.Scale); }
            return Math.Max(scale, topology.GridSize);
        }

        static double OrientationResidual(double left, double right)
        {
            double delta = Math.Abs(left - right) % 180.0;
            delta = Math.Min(delta, 180.0 - delta);
            return Math.Min(delta, Math.Abs(90.0 - delta));
        }

        static double PointSegmentDistance(
            double px,
            double py,
            double startX,
            double startY,
            double endX,
            double endY)
        {
            double dx = endX - startX;
            double dy = endY - startY;
            double denominator = dx * dx + dy * dy;
            if (denominator <= 0) { return Distance(px, py, startX, startY); }
            double parameter = ((px - startX) * dx + (py - startY) * dy) / denominator;
            parameter = Math.Max(0, Math.Min(1, parameter));
            return Distance(px, py, startX + parameter * dx, startY + parameter * dy);
        }

        static double Distance(double leftX, double leftY, double rightX, double rightY)
        {
            double dx = rightX - leftX;
            double dy = rightY - leftY;
            return Math.Sqrt(dx * dx + dy * dy);
        }

        static bool SameDrawing(string left, string right)
        {
            return string.Equals(left ?? "", right ?? "", StringComparison.Ordinal);
        }

        static void ValidateConfig(MechanicalInterfaceAdjacencyConfig config)
        {
            if (config.CenterToleranceRatio <= 0
                || config.TerminalBoundaryToleranceRatio <= 0
                || config.MinimumNestedSizeSeparationRatio < 0
                || config.MinimumNestedSizeSeparationRatio >= 1
                || config.AngularToleranceDegrees < 0
                || config.AngularToleranceDegrees > 45
                || config.MaximumFeatureCount <= 0
                || config.MaximumPatternCount <= 0
                || config.MaximumAdjacencyCount <= 0
                || config.MaximumTerminalMatchesPerEndpoint <= 0
                || config.MaximumIndexCellsPerSegment <= 0)
            {
                throw new ArgumentOutOfRangeException(
                    "config",
                    "Mechanical interface/adjacency configuration is outside its supported range.");
            }
        }

        static string Hash(IEnumerable<string> values)
        {
            string text = string.Join("\u001f", values ?? Enumerable.Empty<string>());
            using (SHA256 sha = SHA256.Create())
            {
                return BitConverter.ToString(sha.ComputeHash(Encoding.UTF8.GetBytes(text)))
                    .Replace("-", "").Substring(0, 20).ToLowerInvariant();
            }
        }
    }

    static class InterfaceAdjacencyMaps
    {
        public static Dictionary<string, object> Map(params object[] values)
        {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            for (int index = 0; index + 1 < values.Length; index += 2)
            {
                result[(string)values[index]] = values[index + 1];
            }
            return result;
        }

        public static object Nullable(double? value)
        {
            return value.HasValue ? (object)value.Value : null;
        }

        public static List<string> SortedUnique(IEnumerable<string> values)
        {
            return values == null
                ? new List<string>()
                : values.Where(value => !string.IsNullOrWhiteSpace(value))
                    .Distinct(StringComparer.Ordinal)
                    .OrderBy(value => value, StringComparer.Ordinal).ToList();
        }
    }
}
