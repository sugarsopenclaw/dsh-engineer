using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.Text;

namespace Shb.Cad.Core
{
    public sealed class PlanarTopologyConfig
    {
        readonly HashSet<string> excludedRoles;

        public PlanarTopologyConfig()
        {
            SnapTolerance = 0.05;
            GridSize = 0.001;
            IntersectionTolerance = 0.0000001;
            PlanarityTolerance = 0.01;
            MinimumFragmentLength = 0.001;
            MinimumFaceArea = 0.000001;
            MaxInputSegmentCount = 250000;
            MaxCandidatePairCount = 12000000;
            MaxCellsPerSegment = 4096;
            EnableEndpointToSegmentSnap = true;
            IncludeInvisible = false;
            excludedRoles = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "annotation_geometry",
                "center_reference",
                "double_chain_reference",
                "section_hatching"
            };
        }

        public double SnapTolerance { get; set; }
        public double GridSize { get; set; }
        public double IntersectionTolerance { get; set; }
        public double PlanarityTolerance { get; set; }
        public double MinimumFragmentLength { get; set; }
        public double MinimumFaceArea { get; set; }
        public int MaxInputSegmentCount { get; set; }
        public int MaxCandidatePairCount { get; set; }
        public int MaxCellsPerSegment { get; set; }
        public bool EnableEndpointToSegmentSnap { get; set; }
        public bool IncludeInvisible { get; set; }
        public ICollection<string> ExcludedRoles { get { return excludedRoles; } }

        public PlanarTopologyConfig ExcludeRole(string role)
        {
            if (!string.IsNullOrEmpty(role))
            {
                excludedRoles.Add(role);
            }
            return this;
        }

        public PlanarTopologyConfig IncludeRole(string role)
        {
            if (!string.IsNullOrEmpty(role))
            {
                excludedRoles.Remove(role);
            }
            return this;
        }

        internal bool IsRoleExcluded(string role)
        {
            return excludedRoles.Contains(role ?? "");
        }
    }

    public sealed class PlanarSnapClusterRecord
    {
        readonly List<string> endpointIds;

        internal PlanarSnapClusterRecord(
            string id,
            IList<string> endpoints,
            double originalX,
            double originalY,
            double snappedX,
            double snappedY,
            string targetKind,
            string targetId,
            double maxMemberDisplacement,
            double maxPairDistance,
            string status)
        {
            Id = id ?? "";
            endpointIds = endpoints == null ? new List<string>() : new List<string>(endpoints);
            OriginalRepresentativeX = originalX;
            OriginalRepresentativeY = originalY;
            SnappedX = snappedX;
            SnappedY = snappedY;
            TargetKind = targetKind ?? "authored_endpoint";
            TargetId = targetId ?? "";
            MaxMemberDisplacement = maxMemberDisplacement;
            MaxPairDistance = maxPairDistance;
            Status = status ?? "computed";
        }

        public string Id { get; private set; }
        public IList<string> EndpointIds { get { return endpointIds.AsReadOnly(); } }
        public double OriginalRepresentativeX { get; private set; }
        public double OriginalRepresentativeY { get; private set; }
        public double SnappedX { get; private set; }
        public double SnappedY { get; private set; }
        public string TargetKind { get; private set; }
        public string TargetId { get; private set; }
        public double MaxMemberDisplacement { get; private set; }
        public double MaxPairDistance { get; private set; }
        public string Status { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return PlanarMaps.Map(
                "cluster_id", Id,
                "endpoint_ids", new List<string>(endpointIds),
                "original_representative", new[] { OriginalRepresentativeX, OriginalRepresentativeY },
                "snapped", new[] { SnappedX, SnappedY },
                "target_kind", TargetKind,
                "target_id", string.IsNullOrEmpty(TargetId) ? null : (object)TargetId,
                "max_member_displacement", MaxMemberDisplacement,
                "max_pair_distance", MaxPairDistance,
                "status", Status,
                "mutation_status", "plan_only_source_geometry_unchanged");
        }
    }

    public sealed class PlanarVertexRecord
    {
        readonly List<string> incidentEdgeIds;

        internal PlanarVertexRecord(string id, long gridX, long gridY, double x, double y)
        {
            Id = id ?? "";
            GridX = gridX;
            GridY = gridY;
            X = x;
            Y = y;
            incidentEdgeIds = new List<string>();
        }

        public string Id { get; private set; }
        public long GridX { get; private set; }
        public long GridY { get; private set; }
        public double X { get; private set; }
        public double Y { get; private set; }
        public IList<string> IncidentEdgeIds { get { return incidentEdgeIds.AsReadOnly(); } }
        public int Degree { get { return incidentEdgeIds.Count; } }
        public string ComponentId { get; internal set; }

        internal void AddEdge(string edgeId)
        {
            if (!incidentEdgeIds.Contains(edgeId))
            {
                incidentEdgeIds.Add(edgeId);
            }
        }

        public Dictionary<string, object> ToMap()
        {
            return PlanarMaps.Map(
                "vertex_id", Id,
                "grid", new[] { GridX, GridY },
                "point", new[] { X, Y },
                "degree", Degree,
                "incident_edge_ids", new List<string>(incidentEdgeIds),
                "component_id", ComponentId);
        }
    }

    public sealed class PlanarEdgeSupportRecord
    {
        internal PlanarEdgeSupportRecord(
            string occurrenceId,
            string sourceHandle,
            int sourceSegmentIndex,
            double parameterStart,
            double parameterEnd,
            bool followsCanonicalDirection,
            string semanticRole,
            string geometryQuality)
        {
            OccurrenceId = occurrenceId ?? "";
            SourceHandle = sourceHandle ?? "";
            SourceSegmentIndex = sourceSegmentIndex;
            ParameterStart = parameterStart;
            ParameterEnd = parameterEnd;
            FollowsCanonicalDirection = followsCanonicalDirection;
            SemanticRole = semanticRole ?? "unclassified";
            GeometryQuality = geometryQuality ?? "";
        }

        public string OccurrenceId { get; private set; }
        public string SourceHandle { get; private set; }
        public int SourceSegmentIndex { get; private set; }
        public double ParameterStart { get; private set; }
        public double ParameterEnd { get; private set; }
        public bool FollowsCanonicalDirection { get; private set; }
        public string SemanticRole { get; private set; }
        public string GeometryQuality { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return PlanarMaps.Map(
                "occurrence_id", OccurrenceId,
                "source_handle", SourceHandle,
                "source_segment_index", SourceSegmentIndex,
                "source_parameter_interval", new[] { ParameterStart, ParameterEnd },
                "follows_canonical_direction", FollowsCanonicalDirection,
                "semantic_role", SemanticRole,
                "geometry_quality", GeometryQuality);
        }
    }

    public sealed class PlanarEdgeRecord
    {
        readonly List<PlanarEdgeSupportRecord> supports;

        internal PlanarEdgeRecord(
            string id,
            string startVertexId,
            string endVertexId,
            IList<PlanarEdgeSupportRecord> supportValues,
            double length)
        {
            Id = id ?? "";
            StartVertexId = startVertexId ?? "";
            EndVertexId = endVertexId ?? "";
            supports = supportValues == null
                ? new List<PlanarEdgeSupportRecord>()
                : new List<PlanarEdgeSupportRecord>(supportValues);
            Length = length;
        }

        public string Id { get; private set; }
        public string StartVertexId { get; private set; }
        public string EndVertexId { get; private set; }
        public IList<PlanarEdgeSupportRecord> Supports { get { return supports.AsReadOnly(); } }
        public double Length { get; private set; }
        public string ComponentId { get; internal set; }
        public bool HasCoincidentSupport { get { return supports.Count > 1; } }

        public Dictionary<string, object> ToMap()
        {
            var values = new List<Dictionary<string, object>>();
            foreach (PlanarEdgeSupportRecord support in supports)
            {
                values.Add(support.ToMap());
            }
            return PlanarMaps.Map(
                "edge_id", Id,
                "start_vertex_id", StartVertexId,
                "end_vertex_id", EndVertexId,
                "length", Length,
                "component_id", ComponentId,
                "source_support_count", supports.Count,
                "coincident_support", HasCoincidentSupport,
                "source_supports", values);
        }
    }

    public sealed class PlanarHalfEdgeRecord
    {
        internal PlanarHalfEdgeRecord(
            string id,
            string edgeId,
            string originVertexId,
            string destinationVertexId,
            string twinId,
            string nextId,
            string ringId)
        {
            Id = id ?? "";
            EdgeId = edgeId ?? "";
            OriginVertexId = originVertexId ?? "";
            DestinationVertexId = destinationVertexId ?? "";
            TwinId = twinId ?? "";
            NextId = nextId ?? "";
            RingId = ringId ?? "";
        }

        public string Id { get; private set; }
        public string EdgeId { get; private set; }
        public string OriginVertexId { get; private set; }
        public string DestinationVertexId { get; private set; }
        public string TwinId { get; private set; }
        public string NextId { get; private set; }
        public string RingId { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return PlanarMaps.Map(
                "halfedge_id", Id,
                "edge_id", EdgeId,
                "origin_vertex_id", OriginVertexId,
                "destination_vertex_id", DestinationVertexId,
                "twin_id", TwinId,
                "next_id", NextId,
                "ring_id", RingId);
        }
    }

    public sealed class PlanarFaceRecord
    {
        readonly List<string> outerVertexIds;
        readonly List<List<string>> holeVertexIds;

        internal PlanarFaceRecord(
            string id,
            IList<string> outer,
            IList<List<string>> holes,
            double grossArea,
            double netArea,
            double perimeter,
            string status)
        {
            Id = id ?? "";
            outerVertexIds = outer == null ? new List<string>() : new List<string>(outer);
            holeVertexIds = new List<List<string>>();
            if (holes != null)
            {
                foreach (List<string> hole in holes)
                {
                    holeVertexIds.Add(hole == null ? new List<string>() : new List<string>(hole));
                }
            }
            GrossArea = grossArea;
            NetArea = netArea;
            Perimeter = perimeter;
            Status = status ?? "computed";
        }

        public string Id { get; private set; }
        public IList<string> OuterVertexIds { get { return outerVertexIds.AsReadOnly(); } }
        public double GrossArea { get; private set; }
        public double NetArea { get; private set; }
        public double Perimeter { get; private set; }
        public int HoleCount { get { return holeVertexIds.Count; } }
        public IList<IList<string>> HoleVertexIds
        {
            get
            {
                var values = new List<IList<string>>();
                foreach (List<string> hole in holeVertexIds)
                {
                    values.Add(hole.AsReadOnly());
                }
                return values.AsReadOnly();
            }
        }
        public string Status { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            var holes = new List<List<string>>();
            foreach (List<string> hole in holeVertexIds)
            {
                holes.Add(new List<string>(hole));
            }
            return PlanarMaps.Map(
                "face_id", Id,
                "outer_vertex_ids", new List<string>(outerVertexIds),
                "hole_vertex_ids", holes,
                "gross_area", GrossArea,
                "net_area", NetArea,
                "perimeter", Perimeter,
                "hole_count", HoleCount,
                "status", Status);
        }
    }

    public sealed class PlanarTopologyComponentRecord
    {
        internal PlanarTopologyComponentRecord(
            string id,
            int vertexCount,
            int edgeCount,
            int endpointCount,
            int branchCount)
        {
            Id = id ?? "";
            VertexCount = vertexCount;
            EdgeCount = edgeCount;
            EndpointCount = endpointCount;
            BranchVertexCount = branchCount;
        }

        public string Id { get; private set; }
        public int VertexCount { get; private set; }
        public int EdgeCount { get; private set; }
        public int EndpointCount { get; private set; }
        public int BranchVertexCount { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return PlanarMaps.Map(
                "component_id", Id,
                "vertex_count", VertexCount,
                "edge_count", EdgeCount,
                "endpoint_count", EndpointCount,
                "branch_vertex_count", BranchVertexCount);
        }
    }

    public sealed class PlanarTopologyDiagnosticRecord
    {
        internal PlanarTopologyDiagnosticRecord(
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
            return PlanarMaps.Map(
                "code", Code,
                "status", Status,
                "source_id", SourceId,
                "message", Message);
        }
    }

    public sealed class PlanarTopologyValidationRecord
    {
        internal PlanarTopologyValidationRecord(
            string name,
            bool passed,
            string actual,
            string expected)
        {
            Name = name ?? "";
            Passed = passed;
            Actual = actual ?? "";
            Expected = expected ?? "";
        }

        public string Name { get; private set; }
        public bool Passed { get; private set; }
        public string Actual { get; private set; }
        public string Expected { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return PlanarMaps.Map(
                "name", Name,
                "passed", Passed,
                "actual", Actual,
                "expected", Expected);
        }
    }

    public sealed class PlanarTopologyDocument
    {
        readonly List<PlanarSnapClusterRecord> snapClusters;
        readonly List<PlanarVertexRecord> vertices;
        readonly List<PlanarEdgeRecord> edges;
        readonly List<PlanarHalfEdgeRecord> halfEdges;
        readonly List<PlanarFaceRecord> faces;
        readonly List<PlanarTopologyComponentRecord> components;
        readonly List<PlanarTopologyDiagnosticRecord> diagnostics;
        readonly List<PlanarTopologyValidationRecord> validations;
        readonly Dictionary<string, double> stageElapsedMilliseconds;

        internal PlanarTopologyDocument(
            string drawingId,
            int curveOccurrenceCount,
            int inputSegmentCount,
            int endpointClusterCount,
            int intersectionCount,
            int overlapCount,
            int ringCount,
            int positiveRingCount,
            int negativeRingCount,
            int degenerateRingCount,
            int combinatorialCycleRank,
            int unresolvedCycleCount,
            double gridSize,
            IList<PlanarSnapClusterRecord> snapValues,
            IList<PlanarVertexRecord> vertexValues,
            IList<PlanarEdgeRecord> edgeValues,
            IList<PlanarHalfEdgeRecord> halfEdgeValues,
            IList<PlanarFaceRecord> faceValues,
            IList<PlanarTopologyComponentRecord> componentValues,
            IList<PlanarTopologyDiagnosticRecord> diagnosticValues,
            IList<PlanarTopologyValidationRecord> validationValues,
            IDictionary<string, double> stageElapsedValues)
        {
            DrawingId = drawingId ?? "";
            CurveOccurrenceCount = curveOccurrenceCount;
            InputSegmentCount = inputSegmentCount;
            EndpointClusterCount = endpointClusterCount;
            IntersectionCount = intersectionCount;
            CollinearOverlapCount = overlapCount;
            RingCount = ringCount;
            PositiveRingCount = positiveRingCount;
            NegativeRingCount = negativeRingCount;
            DegenerateRingCount = degenerateRingCount;
            CombinatorialCycleRank = combinatorialCycleRank;
            UnresolvedCycleCount = unresolvedCycleCount;
            GridSize = gridSize;
            snapClusters = Copy(snapValues);
            vertices = Copy(vertexValues);
            edges = Copy(edgeValues);
            halfEdges = Copy(halfEdgeValues);
            faces = Copy(faceValues);
            components = Copy(componentValues);
            diagnostics = Copy(diagnosticValues);
            validations = Copy(validationValues);
            stageElapsedMilliseconds = stageElapsedValues == null
                ? new Dictionary<string, double>(StringComparer.Ordinal)
                : new Dictionary<string, double>(stageElapsedValues, StringComparer.Ordinal);
            Status = "computed";
            foreach (PlanarTopologyValidationRecord validation in validations)
            {
                if (!validation.Passed)
                {
                    Status = "ambiguous";
                    break;
                }
            }
            foreach (PlanarTopologyDiagnosticRecord diagnostic in diagnostics)
            {
                if (diagnostic.Status == "unsupported")
                {
                    Status = "unsupported_partial";
                    break;
                }
                if (diagnostic.Status == "ambiguous" && Status == "computed")
                {
                    Status = "ambiguous";
                }
            }
        }

        public string DrawingId { get; private set; }
        public int CurveOccurrenceCount { get; private set; }
        public int InputSegmentCount { get; private set; }
        public int EndpointClusterCount { get; private set; }
        public int IntersectionCount { get; private set; }
        public int CollinearOverlapCount { get; private set; }
        public int RingCount { get; private set; }
        public int PositiveRingCount { get; private set; }
        public int NegativeRingCount { get; private set; }
        public int DegenerateRingCount { get; private set; }
        public int CombinatorialCycleRank { get; private set; }
        public int UnresolvedCycleCount { get; private set; }
        public double GridSize { get; private set; }
        public string Status { get; private set; }
        public IList<PlanarSnapClusterRecord> SnapClusters { get { return snapClusters.AsReadOnly(); } }
        public IList<PlanarVertexRecord> Vertices { get { return vertices.AsReadOnly(); } }
        public IList<PlanarEdgeRecord> Edges { get { return edges.AsReadOnly(); } }
        public IList<PlanarHalfEdgeRecord> HalfEdges { get { return halfEdges.AsReadOnly(); } }
        public IList<PlanarFaceRecord> Faces { get { return faces.AsReadOnly(); } }
        public IList<PlanarTopologyComponentRecord> Components { get { return components.AsReadOnly(); } }
        public IList<PlanarTopologyDiagnosticRecord> Diagnostics { get { return diagnostics.AsReadOnly(); } }
        public IList<PlanarTopologyValidationRecord> Validations { get { return validations.AsReadOnly(); } }
        public IDictionary<string, double> StageElapsedMilliseconds
        {
            get
            {
                return new Dictionary<string, double>(
                    stageElapsedMilliseconds,
                    StringComparer.Ordinal);
            }
        }

        public Dictionary<string, object> ToMap()
        {
            return PlanarMaps.Map(
                "schema_version", "1",
                "analysis_type", "planar_topology_kernel",
                "analyzer_version", "1",
                "drawing_id", DrawingId,
                "status", Status,
                "curve_occurrence_count", CurveOccurrenceCount,
                "input_segment_count", InputSegmentCount,
                "endpoint_cluster_count", EndpointClusterCount,
                "nontrivial_snap_cluster_count", snapClusters.Count,
                "intersection_count", IntersectionCount,
                "intersection_count_semantics", "intersecting_source_segment_pair_events_including_shared_endpoints",
                "collinear_overlap_count", CollinearOverlapCount,
                "vertex_count", vertices.Count,
                "edge_count", edges.Count,
                "halfedge_count", halfEdges.Count,
                "ring_count", RingCount,
                "positive_area_ring_count", PositiveRingCount,
                "negative_area_ring_count", NegativeRingCount,
                "degenerate_ring_count", DegenerateRingCount,
                "combinatorial_cycle_rank", CombinatorialCycleRank,
                "unresolved_cycle_count", UnresolvedCycleCount,
                "bounded_face_count", faces.Count,
                "component_count", components.Count,
                "grid_size", GridSize,
                "stage_elapsed_ms", new Dictionary<string, double>(
                    stageElapsedMilliseconds,
                    StringComparer.Ordinal),
                "snap_plan", Maps(snapClusters),
                "vertices", Maps(vertices),
                "edges", Maps(edges),
                "halfedges", Maps(halfEdges),
                "faces", Maps(faces),
                "components", Maps(components),
                "diagnostics", Maps(diagnostics),
                "validations", Maps(validations),
                "topology_contract", PlanarMaps.Map(
                    "source_geometry", "11 world-coordinate occurrence paths",
                    "snap", "non-mutating deterministic endpoint/segment projection plan",
                    "noding", "all proper intersections and collinear overlap endpoints split",
                    "canonicalization", "fixed integer grid",
                    "edge_identity", "undirected fragment with all source supports retained",
                    "faces", "DCEL left-face traversal with nested-ring holes",
                    "normal_statuses", new[] { "computed", "ambiguous", "unsupported_partial" }),
                "mutation_status", "read_only_no_entities_modified");
        }

        public string ToMarkdown()
        {
            var sb = new StringBuilder();
            sb.AppendLine("# 切节点平面拓扑");
            sb.AppendLine();
            sb.AppendLine("- 图纸：`" + DrawingId + "`");
            sb.AppendLine("- 状态：`" + Status + "`");
            sb.AppendLine("- 输入曲线实例 / 线段：" + CurveOccurrenceCount.ToString(CultureInfo.InvariantCulture)
                + " / " + InputSegmentCount.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("- 顶点 / 边 / 有界面：" + vertices.Count.ToString(CultureInfo.InvariantCulture)
                + " / " + edges.Count.ToString(CultureInfo.InvariantCulture)
                + " / " + faces.Count.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("- 相交线段对事件 / 共线重叠：" + IntersectionCount.ToString(CultureInfo.InvariantCulture)
                + " / " + CollinearOverlapCount.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("- 非平凡吸附计划：" + snapClusters.Count.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("- 环 / 退化环 / 未成面环秩：" + RingCount.ToString(CultureInfo.InvariantCulture)
                + " / " + DegenerateRingCount.ToString(CultureInfo.InvariantCulture)
                + " / " + UnresolvedCycleCount.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine();
            sb.AppendLine("每条拓扑边保留全部 definition/entity/instance 支持区间；吸附与量化只作用于派生拓扑，不改源图。");
            return sb.ToString().TrimEnd();
        }

        static List<T> Copy<T>(IList<T> values)
        {
            return values == null ? new List<T>() : new List<T>(values);
        }

        static List<Dictionary<string, object>> Maps<T>(IList<T> values)
        {
            var result = new List<Dictionary<string, object>>();
            if (values == null) { return result; }
            foreach (T value in values)
            {
                if (value == null) { continue; }
                System.Reflection.MethodInfo method = value.GetType().GetMethod("ToMap");
                if (method != null)
                {
                    result.Add((Dictionary<string, object>)method.Invoke(value, null));
                }
            }
            return result;
        }
    }

    public static class PlanarTopologyAnalyzer
    {
        sealed class InputSegment
        {
            public int Index;
            public string Id;
            public InstanceOccurrenceRecord Occurrence;
            public int SourceSegmentIndex;
            public double OriginalAx;
            public double OriginalAy;
            public double OriginalBx;
            public double OriginalBy;
            public double Ax;
            public double Ay;
            public double Bx;
            public double By;
            public bool StartSnapEligible;
            public bool EndSnapEligible;
            public readonly List<double> Parameters = new List<double> { 0, 1 };

            public double MinX { get { return Math.Min(Ax, Bx); } }
            public double MinY { get { return Math.Min(Ay, By); } }
            public double MaxX { get { return Math.Max(Ax, Bx); } }
            public double MaxY { get { return Math.Max(Ay, By); } }
        }

        sealed class Endpoint
        {
            public int Index;
            public int SegmentIndex;
            public bool IsStart;
            public string Id;
            public double X;
            public double Y;
        }

        sealed class SnapGroup
        {
            public int Root;
            public readonly List<Endpoint> Members = new List<Endpoint>();
            public double OriginalX;
            public double OriginalY;
            public double X;
            public double Y;
            public string TargetKind = "authored_endpoint";
            public string TargetId = "";
            public string Status = "computed";
            public double MaxPairDistance;
        }

        sealed class DisjointSet
        {
            readonly int[] parent;
            readonly byte[] rank;

            public DisjointSet(int count)
            {
                parent = new int[count];
                rank = new byte[count];
                for (int i = 0; i < count; i++) { parent[i] = i; }
            }

            public int Find(int value)
            {
                int root = value;
                while (parent[root] != root) { root = parent[root]; }
                while (parent[value] != value)
                {
                    int next = parent[value];
                    parent[value] = root;
                    value = next;
                }
                return root;
            }

            public void Union(int left, int right)
            {
                int a = Find(left);
                int b = Find(right);
                if (a == b) { return; }
                if (rank[a] < rank[b]) { parent[a] = b; }
                else if (rank[a] > rank[b]) { parent[b] = a; }
                else { parent[b] = a; rank[a]++; }
            }
        }

        sealed class FragmentSupport
        {
            public InputSegment Segment;
            public double T0;
            public double T1;
            public string StartKey;
            public string EndKey;
        }

        sealed class VertexBuilder
        {
            public string Key;
            public long GridX;
            public long GridY;
            public double X;
            public double Y;
            public string Id;
        }

        sealed class EdgeBuilder
        {
            public string Key;
            public VertexBuilder Start;
            public VertexBuilder End;
            public readonly List<FragmentSupport> Supports = new List<FragmentSupport>();
            public string Id;
        }

        sealed class HalfEdgeBuilder
        {
            public string Id;
            public EdgeBuilder Edge;
            public VertexBuilder Origin;
            public VertexBuilder Destination;
            public HalfEdgeBuilder Twin;
            public HalfEdgeBuilder Next;
            public string RingId;
            public double Angle;
        }

        sealed class RingBuilder
        {
            public string Id;
            public readonly List<HalfEdgeBuilder> HalfEdges = new List<HalfEdgeBuilder>();
            public readonly List<VertexBuilder> Vertices = new List<VertexBuilder>();
            public double SignedArea;
            public double Perimeter;
            public double SampleX;
            public double SampleY;
            public RingBuilder Parent;
            public readonly List<RingBuilder> Children = new List<RingBuilder>();
            public bool HasRepeatedVertex;
        }

        public static PlanarTopologyDocument Analyze(
            BlockInstanceCoordinateDocument instances,
            PlanarTopologyConfig config = null)
        {
            if (instances == null)
            {
                throw new ArgumentNullException("instances");
            }
            config = config ?? new PlanarTopologyConfig();
            ValidateConfig(config);
            var diagnostics = new List<PlanarTopologyDiagnosticRecord>();
            var stageElapsed = new Dictionary<string, double>(StringComparer.Ordinal);
            Stopwatch stageWatch = Stopwatch.StartNew();
            int curveOccurrenceCount;
            List<InputSegment> segments = BuildSegments(
                instances,
                config,
                diagnostics,
                out curveOccurrenceCount);
            Stage(stageElapsed, "build_input_segments", stageWatch);
            int endpointClusterCount;
            List<PlanarSnapClusterRecord> snapRecords = ApplySnapPlan(
                segments,
                config,
                diagnostics,
                out endpointClusterCount);
            Stage(stageElapsed, "snap_plan", stageWatch);
            int intersectionCount = 0;
            int overlapCount = 0;
            NodeSegments(
                segments,
                config,
                diagnostics,
                ref intersectionCount,
                ref overlapCount);
            Stage(stageElapsed, "intersection_noding", stageWatch);
            List<VertexBuilder> vertexBuilders;
            List<EdgeBuilder> edgeBuilders;
            BuildArrangement(
                segments,
                config,
                diagnostics,
                out vertexBuilders,
                out edgeBuilders);
            Stage(stageElapsed, "fragment_arrangement", stageWatch);
            List<PlanarVertexRecord> vertices;
            List<PlanarEdgeRecord> edges;
            List<PlanarTopologyComponentRecord> components;
            MaterializeGraph(
                vertexBuilders,
                edgeBuilders,
                out vertices,
                out edges,
                out components);
            Stage(stageElapsed, "connected_components", stageWatch);
            List<PlanarHalfEdgeRecord> halfEdges;
            List<PlanarFaceRecord> faces;
            List<PlanarTopologyValidationRecord> validations;
            int ringCount;
            int positiveRingCount;
            int negativeRingCount;
            int degenerateRingCount;
            int combinatorialCycleRank;
            int unresolvedCycleCount;
            BuildDcel(
                vertexBuilders,
                edgeBuilders,
                components.Count,
                config,
                diagnostics,
                out halfEdges,
                out faces,
                out validations,
                out ringCount,
                out positiveRingCount,
                out negativeRingCount,
                out degenerateRingCount,
                out combinatorialCycleRank,
                out unresolvedCycleCount);
            Stage(stageElapsed, "dcel_and_faces", stageWatch);
            return new PlanarTopologyDocument(
                instances.DrawingId,
                curveOccurrenceCount,
                segments.Count,
                endpointClusterCount,
                intersectionCount,
                overlapCount,
                ringCount,
                positiveRingCount,
                negativeRingCount,
                degenerateRingCount,
                combinatorialCycleRank,
                unresolvedCycleCount,
                config.GridSize,
                snapRecords,
                vertices,
                edges,
                halfEdges,
                faces,
                components,
                diagnostics,
                validations,
                stageElapsed);
        }

        static void ValidateConfig(PlanarTopologyConfig config)
        {
            if (!(config.SnapTolerance > 0)) { throw new ArgumentOutOfRangeException("SnapTolerance"); }
            if (!(config.GridSize > 0)) { throw new ArgumentOutOfRangeException("GridSize"); }
            if (config.GridSize > config.SnapTolerance)
            {
                throw new ArgumentException("GridSize must not exceed SnapTolerance.");
            }
            if (!(config.IntersectionTolerance > 0))
            {
                throw new ArgumentOutOfRangeException("IntersectionTolerance");
            }
        }

        static List<InputSegment> BuildSegments(
            BlockInstanceCoordinateDocument instances,
            PlanarTopologyConfig config,
            IList<PlanarTopologyDiagnosticRecord> diagnostics,
            out int curveOccurrenceCount)
        {
            var result = new List<InputSegment>();
            curveOccurrenceCount = 0;
            foreach (InstanceOccurrenceRecord occurrence in instances.Occurrences)
            {
                if (occurrence == null || !occurrence.HasWorldPath)
                {
                    continue;
                }
                if (!config.IncludeInvisible && !occurrence.Visible)
                {
                    continue;
                }
                if (config.IsRoleExcluded(occurrence.SemanticRole))
                {
                    continue;
                }
                double minZ = occurrence.WorldPath[0].Z;
                double maxZ = minZ;
                foreach (InstancePoint3Observation point in occurrence.WorldPath)
                {
                    minZ = Math.Min(minZ, point.Z);
                    maxZ = Math.Max(maxZ, point.Z);
                }
                if (maxZ - minZ > config.PlanarityTolerance)
                {
                    diagnostics.Add(new PlanarTopologyDiagnosticRecord(
                        "NON_PLANAR_CURVE_EXCLUDED",
                        "unsupported",
                        occurrence.Id,
                        "Curve Z span exceeds the configured planar tolerance."));
                    continue;
                }
                curveOccurrenceCount++;
                int count = occurrence.WorldPath.Count;
                int pairCount = occurrence.IsClosed ? count : count - 1;
                for (int index = 0; index < pairCount; index++)
                {
                    if (result.Count >= config.MaxInputSegmentCount)
                    {
                        diagnostics.Add(new PlanarTopologyDiagnosticRecord(
                            "INPUT_SEGMENT_LIMIT_REACHED",
                            "unsupported",
                            occurrence.Id,
                            "Input was truncated at the configured segment limit."));
                        return result;
                    }
                    InstancePoint3Observation a = occurrence.WorldPath[index];
                    InstancePoint3Observation b = occurrence.WorldPath[(index + 1) % count];
                    if (Distance(a.X, a.Y, b.X, b.Y) <= config.IntersectionTolerance)
                    {
                        diagnostics.Add(new PlanarTopologyDiagnosticRecord(
                            "ZERO_LENGTH_SOURCE_SEGMENT",
                            "ambiguous",
                            occurrence.Id + "#seg:" + index.ToString(CultureInfo.InvariantCulture),
                            "Zero-length source segment was retained only as a diagnostic."));
                        continue;
                    }
                    result.Add(new InputSegment
                    {
                        Index = result.Count,
                        Id = occurrence.Id + "#seg:" + index.ToString(CultureInfo.InvariantCulture),
                        Occurrence = occurrence,
                        SourceSegmentIndex = index,
                        OriginalAx = a.X,
                        OriginalAy = a.Y,
                        OriginalBx = b.X,
                        OriginalBy = b.Y,
                        Ax = a.X,
                        Ay = a.Y,
                        Bx = b.X,
                        By = b.Y,
                        StartSnapEligible = IsSnapEligiblePathVertex(
                            occurrence,
                            index,
                            pairCount,
                            true),
                        EndSnapEligible = IsSnapEligiblePathVertex(
                            occurrence,
                            index,
                            pairCount,
                            false)
                    });
                }
            }
            return result;
        }

        static List<PlanarSnapClusterRecord> ApplySnapPlan(
            IList<InputSegment> segments,
            PlanarTopologyConfig config,
            IList<PlanarTopologyDiagnosticRecord> diagnostics,
            out int endpointClusterCount)
        {
            var endpoints = new List<Endpoint>(segments.Count * 2);
            foreach (InputSegment segment in segments)
            {
                if (segment.StartSnapEligible)
                {
                    endpoints.Add(new Endpoint
                    {
                        Index = endpoints.Count,
                        SegmentIndex = segment.Index,
                        IsStart = true,
                        Id = segment.Id + ":start",
                        X = segment.Ax,
                        Y = segment.Ay
                    });
                }
                if (segment.EndSnapEligible)
                {
                    endpoints.Add(new Endpoint
                    {
                        Index = endpoints.Count,
                        SegmentIndex = segment.Index,
                        IsStart = false,
                        Id = segment.Id + ":end",
                        X = segment.Bx,
                        Y = segment.By
                    });
                }
            }
            var dsu = new DisjointSet(endpoints.Count);
            var buckets = new Dictionary<string, List<int>>(StringComparer.Ordinal);
            double cell = config.SnapTolerance;
            foreach (Endpoint endpoint in endpoints)
            {
                long gx = FloorCell(endpoint.X, cell);
                long gy = FloorCell(endpoint.Y, cell);
                for (long x = gx - 1; x <= gx + 1; x++)
                {
                    for (long y = gy - 1; y <= gy + 1; y++)
                    {
                        List<int> candidates;
                        if (!buckets.TryGetValue(CellKey(x, y), out candidates)) { continue; }
                        foreach (int candidateIndex in candidates)
                        {
                            Endpoint candidate = endpoints[candidateIndex];
                            double endpointDistance = Distance(
                                endpoint.X,
                                endpoint.Y,
                                candidate.X,
                                candidate.Y);
                            bool sameOccurrence = string.Equals(
                                segments[endpoint.SegmentIndex].Occurrence.Id,
                                segments[candidate.SegmentIndex].Occurrence.Id,
                                StringComparison.Ordinal);
                            if (endpointDistance <= config.SnapTolerance
                                && (!sameOccurrence
                                    || endpointDistance <= config.IntersectionTolerance))
                            {
                                dsu.Union(endpoint.Index, candidate.Index);
                            }
                        }
                    }
                }
                string key = CellKey(gx, gy);
                List<int> values;
                if (!buckets.TryGetValue(key, out values))
                {
                    values = new List<int>();
                    buckets[key] = values;
                }
                values.Add(endpoint.Index);
            }

            var groupsByRoot = new Dictionary<int, SnapGroup>();
            foreach (Endpoint endpoint in endpoints)
            {
                int root = dsu.Find(endpoint.Index);
                SnapGroup group;
                if (!groupsByRoot.TryGetValue(root, out group))
                {
                    group = new SnapGroup { Root = root };
                    groupsByRoot[root] = group;
                }
                group.Members.Add(endpoint);
            }
            var groups = new List<SnapGroup>(groupsByRoot.Values);
            groups.Sort(delegate(SnapGroup left, SnapGroup right)
            {
                string a = MinimumEndpointId(left.Members);
                string b = MinimumEndpointId(right.Members);
                return string.CompareOrdinal(a, b);
            });
            foreach (SnapGroup group in groups)
            {
                SelectAuthoredRepresentative(group);
                ComputeMaxPairDistance(group);
                if (group.MaxPairDistance > config.SnapTolerance + config.IntersectionTolerance)
                {
                    group.Status = "ambiguous_transitive_cluster";
                    diagnostics.Add(new PlanarTopologyDiagnosticRecord(
                        "TRANSITIVE_SNAP_CLUSTER_EXCEEDS_TOLERANCE",
                        "ambiguous",
                        MinimumEndpointId(group.Members),
                        "Single-link clustering connected endpoints whose diameter exceeds tolerance."));
                }
            }
            if (config.EnableEndpointToSegmentSnap && segments.Count > 0)
            {
                SnapGroupsToSegmentInteriors(groups, segments, config, diagnostics);
            }
            foreach (SnapGroup group in groups)
            {
                foreach (Endpoint endpoint in group.Members)
                {
                    InputSegment segment = segments[endpoint.SegmentIndex];
                    if (endpoint.IsStart)
                    {
                        segment.Ax = group.X;
                        segment.Ay = group.Y;
                    }
                    else
                    {
                        segment.Bx = group.X;
                        segment.By = group.Y;
                    }
                }
            }
            foreach (InputSegment segment in segments)
            {
                if (Distance(segment.OriginalAx, segment.OriginalAy,
                        segment.OriginalBx, segment.OriginalBy)
                        > config.IntersectionTolerance
                    && Distance(segment.Ax, segment.Ay, segment.Bx, segment.By)
                        <= config.IntersectionTolerance)
                {
                    segment.Ax = segment.OriginalAx;
                    segment.Ay = segment.OriginalAy;
                    segment.Bx = segment.OriginalBx;
                    segment.By = segment.OriginalBy;
                    diagnostics.Add(new PlanarTopologyDiagnosticRecord(
                        "SNAP_REJECTED_TO_PRESERVE_SOURCE_EDGE",
                        "ambiguous",
                        segment.Id,
                        "Conflicting endpoint clusters would collapse this source edge; its snap actions were rejected."));
                }
            }
            var records = new List<PlanarSnapClusterRecord>();
            int clusterIndex = 0;
            foreach (SnapGroup group in groups)
            {
                double maxDisplacement = 0;
                var endpointIds = new List<string>();
                foreach (Endpoint endpoint in group.Members)
                {
                    endpointIds.Add(endpoint.Id);
                    maxDisplacement = Math.Max(
                        maxDisplacement,
                        Distance(endpoint.X, endpoint.Y, group.X, group.Y));
                }
                endpointIds.Sort(StringComparer.Ordinal);
                bool nontrivial = maxDisplacement > config.IntersectionTolerance
                    || group.TargetKind != "authored_endpoint"
                    || group.Status != "computed";
                if (nontrivial)
                {
                    records.Add(new PlanarSnapClusterRecord(
                        "snap:" + clusterIndex.ToString("D6", CultureInfo.InvariantCulture),
                        endpointIds,
                        group.OriginalX,
                        group.OriginalY,
                        group.X,
                        group.Y,
                        group.TargetKind,
                        group.TargetId,
                        maxDisplacement,
                        group.MaxPairDistance,
                        group.Status));
                }
                clusterIndex++;
            }
            endpointClusterCount = groups.Count;
            return records;
        }

        static void SnapGroupsToSegmentInteriors(
            IList<SnapGroup> groups,
            IList<InputSegment> segments,
            PlanarTopologyConfig config,
            IList<PlanarTopologyDiagnosticRecord> diagnostics)
        {
            double cell = AdaptiveCellSize(segments, config.SnapTolerance * 4.0);
            List<int> broad;
            Dictionary<string, List<int>> grid = BuildSegmentGrid(
                segments,
                cell,
                config.MaxCellsPerSegment,
                out broad);
            foreach (SnapGroup group in groups)
            {
                long gx = FloorCell(group.X, cell);
                long gy = FloorCell(group.Y, cell);
                var candidateSet = new HashSet<int>();
                for (long x = gx - 1; x <= gx + 1; x++)
                {
                    for (long y = gy - 1; y <= gy + 1; y++)
                    {
                        List<int> values;
                        if (!grid.TryGetValue(CellKey(x, y), out values)) { continue; }
                        foreach (int value in values) { candidateSet.Add(value); }
                    }
                }
                foreach (int value in broad) { candidateSet.Add(value); }
                var memberSegments = new HashSet<int>();
                var memberOccurrences = new HashSet<string>(StringComparer.Ordinal);
                foreach (Endpoint endpoint in group.Members)
                {
                    memberSegments.Add(endpoint.SegmentIndex);
                    memberOccurrences.Add(segments[endpoint.SegmentIndex].Occurrence.Id);
                }
                double bestDistance = double.MaxValue;
                string bestId = null;
                double bestX = 0;
                double bestY = 0;
                var equalTargets = new List<double[]>();
                foreach (int candidateIndex in candidateSet)
                {
                    if (memberSegments.Contains(candidateIndex)) { continue; }
                    InputSegment segment = segments[candidateIndex];
                    if (memberOccurrences.Contains(segment.Occurrence.Id)) { continue; }
                    double t;
                    double px;
                    double py;
                    double distance = ProjectionDistance(
                        group.X,
                        group.Y,
                        segment.Ax,
                        segment.Ay,
                        segment.Bx,
                        segment.By,
                        out t,
                        out px,
                        out py);
                    if (t <= config.IntersectionTolerance
                        || t >= 1.0 - config.IntersectionTolerance
                        || distance > config.SnapTolerance)
                    {
                        continue;
                    }
                    if (distance < bestDistance - config.IntersectionTolerance
                        || Math.Abs(distance - bestDistance) <= config.IntersectionTolerance
                            && string.CompareOrdinal(segment.Id, bestId) < 0)
                    {
                        bestDistance = distance;
                        bestId = segment.Id;
                        bestX = px;
                        bestY = py;
                        equalTargets.Clear();
                        equalTargets.Add(new[] { px, py });
                    }
                    else if (Math.Abs(distance - bestDistance) <= config.IntersectionTolerance)
                    {
                        equalTargets.Add(new[] { px, py });
                    }
                }
                if (bestId == null) { continue; }
                bool ambiguous = false;
                foreach (double[] target in equalTargets)
                {
                    if (Distance(bestX, bestY, target[0], target[1]) > config.SnapTolerance)
                    {
                        ambiguous = true;
                        break;
                    }
                }
                group.X = bestX;
                group.Y = bestY;
                group.TargetKind = "segment_projection";
                group.TargetId = bestId;
                if (ambiguous)
                {
                    group.Status = "ambiguous_multiple_projection_targets";
                    diagnostics.Add(new PlanarTopologyDiagnosticRecord(
                        "MULTIPLE_ENDPOINT_PROJECTION_TARGETS",
                        "ambiguous",
                        MinimumEndpointId(group.Members),
                        "Several equally near segment interiors imply different snap positions."));
                }
            }
        }

        static void NodeSegments(
            IList<InputSegment> segments,
            PlanarTopologyConfig config,
            IList<PlanarTopologyDiagnosticRecord> diagnostics,
            ref int intersectionCount,
            ref int overlapCount)
        {
            foreach (InputSegment segment in segments)
            {
                if (Distance(segment.Ax, segment.Ay, segment.Bx, segment.By)
                    <= config.IntersectionTolerance)
                {
                    diagnostics.Add(new PlanarTopologyDiagnosticRecord(
                        "SNAP_COLLAPSED_SOURCE_SEGMENT",
                        "ambiguous",
                        segment.Id,
                        "Snap plan collapsed the segment; it will not generate an edge."));
                }
            }
            if (segments.Count < 2) { return; }
            double cell = AdaptiveCellSize(segments, config.SnapTolerance * 4.0);
            List<int> broad;
            Dictionary<string, List<int>> grid = BuildSegmentGrid(
                segments,
                cell,
                config.MaxCellsPerSegment,
                out broad);
            var seen = new HashSet<long>();
            int candidateCount = 0;
            bool limitReached = false;
            foreach (List<int> values in grid.Values)
            {
                for (int left = 0; left < values.Count; left++)
                {
                    for (int right = left + 1; right < values.Count; right++)
                    {
                        if (!ProcessCandidate(
                            values[left], values[right], segments, seen, config,
                            ref candidateCount, ref intersectionCount, ref overlapCount))
                        {
                            limitReached = true;
                            break;
                        }
                    }
                    if (limitReached) { break; }
                }
                if (limitReached) { break; }
            }
            if (!limitReached)
            {
                var unresolvedBroad = new HashSet<int>(broad);
                double coarseCell = cell * 8.0;
                for (int level = 0; level < 6
                    && unresolvedBroad.Count > 0
                    && !limitReached; level++)
                {
                    List<int> nextBroad;
                    Dictionary<string, List<int>> coarseGrid = BuildSegmentGrid(
                        segments,
                        coarseCell,
                        config.MaxCellsPerSegment,
                        out nextBroad);
                    foreach (List<int> values in coarseGrid.Values)
                    {
                        for (int left = 0; left < values.Count; left++)
                        {
                            for (int right = left + 1; right < values.Count; right++)
                            {
                                if (!unresolvedBroad.Contains(values[left])
                                    && !unresolvedBroad.Contains(values[right]))
                                {
                                    continue;
                                }
                                if (!ProcessCandidate(
                                    values[left], values[right], segments, seen, config,
                                    ref candidateCount, ref intersectionCount, ref overlapCount))
                                {
                                    limitReached = true;
                                    break;
                                }
                            }
                            if (limitReached) { break; }
                        }
                        if (limitReached) { break; }
                    }
                    unresolvedBroad = new HashSet<int>(nextBroad);
                    coarseCell *= 8.0;
                }
                if (!limitReached && unresolvedBroad.Count > 0)
                {
                    foreach (int broadIndex in unresolvedBroad)
                    {
                        for (int other = 0; other < segments.Count; other++)
                        {
                            if (other == broadIndex) { continue; }
                            if (!ProcessCandidate(
                                broadIndex, other, segments, seen, config,
                                ref candidateCount, ref intersectionCount, ref overlapCount))
                            {
                                limitReached = true;
                                break;
                            }
                        }
                        if (limitReached) { break; }
                    }
                }
            }
            if (limitReached)
            {
                diagnostics.Add(new PlanarTopologyDiagnosticRecord(
                    "CANDIDATE_PAIR_LIMIT_REACHED",
                    "unsupported",
                    "",
                    "Intersection search stopped at the configured candidate-pair limit."));
            }
        }

        static bool ProcessCandidate(
            int leftIndex,
            int rightIndex,
            IList<InputSegment> segments,
            ISet<long> seen,
            PlanarTopologyConfig config,
            ref int candidateCount,
            ref int intersectionCount,
            ref int overlapCount)
        {
            if (leftIndex == rightIndex) { return true; }
            int a = Math.Min(leftIndex, rightIndex);
            int b = Math.Max(leftIndex, rightIndex);
            InputSegment left = segments[a];
            InputSegment right = segments[b];
            double tolerance = config.IntersectionTolerance;
            if (left.MaxX + tolerance < right.MinX
                || right.MaxX + tolerance < left.MinX
                || left.MaxY + tolerance < right.MinY
                || right.MaxY + tolerance < left.MinY)
            {
                return true;
            }
            long key = ((long)a << 32) | (uint)b;
            if (!seen.Add(key)) { return true; }
            candidateCount++;
            if (candidateCount > config.MaxCandidatePairCount) { return false; }
            int kind = Intersect(left, right, tolerance);
            if (kind == 1) { intersectionCount++; }
            else if (kind == 2) { overlapCount++; }
            return true;
        }

        // 0 none, 1 point, 2 collinear overlap.
        static int Intersect(InputSegment a, InputSegment b, double tolerance)
        {
            double rx = a.Bx - a.Ax;
            double ry = a.By - a.Ay;
            double sx = b.Bx - b.Ax;
            double sy = b.By - b.Ay;
            double qpx = b.Ax - a.Ax;
            double qpy = b.Ay - a.Ay;
            double rxs = Cross(rx, ry, sx, sy);
            double qpxr = Cross(qpx, qpy, rx, ry);
            double scale = Math.Max(1.0, Math.Max(
                Math.Sqrt(rx * rx + ry * ry),
                Math.Sqrt(sx * sx + sy * sy)));
            double eps = tolerance * scale;
            if (Math.Abs(rxs) <= eps && Math.Abs(qpxr) <= eps)
            {
                double rr = rx * rx + ry * ry;
                double ss = sx * sx + sy * sy;
                if (rr <= tolerance * tolerance || ss <= tolerance * tolerance) { return 0; }
                double t0 = (qpx * rx + qpy * ry) / rr;
                double t1 = t0 + (sx * rx + sy * ry) / rr;
                double lo = Math.Max(0, Math.Min(t0, t1));
                double hi = Math.Min(1, Math.Max(t0, t1));
                if (hi < lo - tolerance) { return 0; }
                lo = Clamp01(lo);
                hi = Clamp01(hi);
                AddParameter(a.Parameters, lo, tolerance);
                AddParameter(a.Parameters, hi, tolerance);
                double lx = a.Ax + rx * lo;
                double ly = a.Ay + ry * lo;
                double hx = a.Ax + rx * hi;
                double hy = a.Ay + ry * hi;
                double u0 = ((lx - b.Ax) * sx + (ly - b.Ay) * sy) / ss;
                double u1 = ((hx - b.Ax) * sx + (hy - b.Ay) * sy) / ss;
                AddParameter(b.Parameters, Clamp01(u0), tolerance);
                AddParameter(b.Parameters, Clamp01(u1), tolerance);
                return hi - lo <= tolerance ? 1 : 2;
            }
            if (Math.Abs(rxs) <= eps) { return 0; }
            double t = Cross(qpx, qpy, sx, sy) / rxs;
            double u = Cross(qpx, qpy, rx, ry) / rxs;
            if (t < -tolerance || t > 1 + tolerance || u < -tolerance || u > 1 + tolerance)
            {
                return 0;
            }
            AddParameter(a.Parameters, Clamp01(t), tolerance);
            AddParameter(b.Parameters, Clamp01(u), tolerance);
            return 1;
        }

        static void BuildArrangement(
            IList<InputSegment> segments,
            PlanarTopologyConfig config,
            IList<PlanarTopologyDiagnosticRecord> diagnostics,
            out List<VertexBuilder> vertices,
            out List<EdgeBuilder> edges)
        {
            var vertexByKey = new Dictionary<string, VertexBuilder>(StringComparer.Ordinal);
            var edgeByKey = new Dictionary<string, EdgeBuilder>(StringComparer.Ordinal);
            foreach (InputSegment segment in segments)
            {
                if (Distance(segment.Ax, segment.Ay, segment.Bx, segment.By)
                    <= config.IntersectionTolerance)
                {
                    continue;
                }
                segment.Parameters.Sort();
                var parameters = Deduplicate(segment.Parameters, config.IntersectionTolerance);
                for (int index = 0; index + 1 < parameters.Count; index++)
                {
                    double t0 = parameters[index];
                    double t1 = parameters[index + 1];
                    double ax = Lerp(segment.Ax, segment.Bx, t0);
                    double ay = Lerp(segment.Ay, segment.By, t0);
                    double bx = Lerp(segment.Ax, segment.Bx, t1);
                    double by = Lerp(segment.Ay, segment.By, t1);
                    VertexBuilder start = VertexOf(vertexByKey, ax, ay, config.GridSize);
                    VertexBuilder end = VertexOf(vertexByKey, bx, by, config.GridSize);
                    if (start.Key == end.Key
                        || Distance(start.X, start.Y, end.X, end.Y) < config.MinimumFragmentLength)
                    {
                        diagnostics.Add(new PlanarTopologyDiagnosticRecord(
                            "QUANTIZATION_COLLAPSED_FRAGMENT",
                            "ambiguous",
                            segment.Id,
                            "A noded fragment collapsed under fixed-grid canonicalization."));
                        continue;
                    }
                    bool forward = string.CompareOrdinal(start.Key, end.Key) < 0;
                    VertexBuilder canonicalStart = forward ? start : end;
                    VertexBuilder canonicalEnd = forward ? end : start;
                    string edgeKey = canonicalStart.Key + "|" + canonicalEnd.Key;
                    EdgeBuilder edge;
                    if (!edgeByKey.TryGetValue(edgeKey, out edge))
                    {
                        edge = new EdgeBuilder
                        {
                            Key = edgeKey,
                            Start = canonicalStart,
                            End = canonicalEnd
                        };
                        edgeByKey[edgeKey] = edge;
                    }
                    edge.Supports.Add(new FragmentSupport
                    {
                        Segment = segment,
                        T0 = t0,
                        T1 = t1,
                        StartKey = start.Key,
                        EndKey = end.Key
                    });
                }
            }
            vertices = new List<VertexBuilder>(vertexByKey.Values);
            vertices.Sort(delegate(VertexBuilder left, VertexBuilder right)
            {
                int compare = left.GridX.CompareTo(right.GridX);
                return compare != 0 ? compare : left.GridY.CompareTo(right.GridY);
            });
            for (int index = 0; index < vertices.Count; index++)
            {
                vertices[index].Id = "v:" + index.ToString("D7", CultureInfo.InvariantCulture);
            }
            edges = new List<EdgeBuilder>(edgeByKey.Values);
            edges.Sort(delegate(EdgeBuilder left, EdgeBuilder right)
            {
                int compare = string.CompareOrdinal(left.Start.Id, right.Start.Id);
                return compare != 0 ? compare : string.CompareOrdinal(left.End.Id, right.End.Id);
            });
            for (int index = 0; index < edges.Count; index++)
            {
                edges[index].Id = "e:" + index.ToString("D7", CultureInfo.InvariantCulture);
            }
        }

        static void MaterializeGraph(
            IList<VertexBuilder> vertexBuilders,
            IList<EdgeBuilder> edgeBuilders,
            out List<PlanarVertexRecord> vertices,
            out List<PlanarEdgeRecord> edges,
            out List<PlanarTopologyComponentRecord> components)
        {
            var vertexRecords = new Dictionary<string, PlanarVertexRecord>(StringComparer.Ordinal);
            vertices = new List<PlanarVertexRecord>();
            foreach (VertexBuilder builder in vertexBuilders)
            {
                var record = new PlanarVertexRecord(
                    builder.Id,
                    builder.GridX,
                    builder.GridY,
                    builder.X,
                    builder.Y);
                vertices.Add(record);
                vertexRecords[builder.Id] = record;
            }
            edges = new List<PlanarEdgeRecord>();
            foreach (EdgeBuilder builder in edgeBuilders)
            {
                var supports = new List<PlanarEdgeSupportRecord>();
                foreach (FragmentSupport support in builder.Supports)
                {
                    bool follows = support.StartKey == builder.Start.Key;
                    supports.Add(new PlanarEdgeSupportRecord(
                        support.Segment.Occurrence.Id,
                        support.Segment.Occurrence.SourceHandle,
                        support.Segment.SourceSegmentIndex,
                        support.T0,
                        support.T1,
                        follows,
                        support.Segment.Occurrence.SemanticRole,
                        support.Segment.Occurrence.GeometryQuality));
                }
                var edge = new PlanarEdgeRecord(
                    builder.Id,
                    builder.Start.Id,
                    builder.End.Id,
                    supports,
                    Distance(builder.Start.X, builder.Start.Y, builder.End.X, builder.End.Y));
                edges.Add(edge);
                vertexRecords[builder.Start.Id].AddEdge(edge.Id);
                vertexRecords[builder.End.Id].AddEdge(edge.Id);
            }
            components = AssignComponents(vertices, edges);
        }

        static List<PlanarTopologyComponentRecord> AssignComponents(
            IList<PlanarVertexRecord> vertices,
            IList<PlanarEdgeRecord> edges)
        {
            var edgesByVertex = new Dictionary<string, List<PlanarEdgeRecord>>(StringComparer.Ordinal);
            var vertexById = new Dictionary<string, PlanarVertexRecord>(StringComparer.Ordinal);
            foreach (PlanarVertexRecord vertex in vertices)
            {
                edgesByVertex[vertex.Id] = new List<PlanarEdgeRecord>();
                vertexById[vertex.Id] = vertex;
            }
            foreach (PlanarEdgeRecord edge in edges)
            {
                edgesByVertex[edge.StartVertexId].Add(edge);
                edgesByVertex[edge.EndVertexId].Add(edge);
            }
            var seen = new HashSet<string>(StringComparer.Ordinal);
            var result = new List<PlanarTopologyComponentRecord>();
            foreach (PlanarVertexRecord seed in vertices)
            {
                if (!seen.Add(seed.Id)) { continue; }
                string componentId = "component:" + result.Count.ToString("D6", CultureInfo.InvariantCulture);
                var queue = new Queue<PlanarVertexRecord>();
                queue.Enqueue(seed);
                var componentVertices = new List<PlanarVertexRecord>();
                var componentEdges = new HashSet<PlanarEdgeRecord>();
                while (queue.Count > 0)
                {
                    PlanarVertexRecord vertex = queue.Dequeue();
                    componentVertices.Add(vertex);
                    vertex.ComponentId = componentId;
                    foreach (PlanarEdgeRecord edge in edgesByVertex[vertex.Id])
                    {
                        componentEdges.Add(edge);
                        edge.ComponentId = componentId;
                        string otherId = edge.StartVertexId == vertex.Id
                            ? edge.EndVertexId
                            : edge.StartVertexId;
                        if (seen.Add(otherId))
                        {
                            PlanarVertexRecord other;
                            vertexById.TryGetValue(otherId, out other);
                            if (other != null) { queue.Enqueue(other); }
                        }
                    }
                }
                int endpointCount = 0;
                int branchCount = 0;
                foreach (PlanarVertexRecord vertex in componentVertices)
                {
                    if (vertex.Degree == 1) { endpointCount++; }
                    if (vertex.Degree > 2) { branchCount++; }
                }
                result.Add(new PlanarTopologyComponentRecord(
                    componentId,
                    componentVertices.Count,
                    componentEdges.Count,
                    endpointCount,
                    branchCount));
            }
            return result;
        }

        static void BuildDcel(
            IList<VertexBuilder> vertices,
            IList<EdgeBuilder> edges,
            int componentCount,
            PlanarTopologyConfig config,
            IList<PlanarTopologyDiagnosticRecord> diagnostics,
            out List<PlanarHalfEdgeRecord> halfEdgeRecords,
            out List<PlanarFaceRecord> faces,
            out List<PlanarTopologyValidationRecord> validations,
            out int ringCount,
            out int positiveRingCount,
            out int negativeRingCount,
            out int degenerateRingCount,
            out int combinatorialCycleRank,
            out int unresolvedCycleCount)
        {
            var halfEdges = new List<HalfEdgeBuilder>();
            var outgoing = new Dictionary<string, List<HalfEdgeBuilder>>(StringComparer.Ordinal);
            foreach (VertexBuilder vertex in vertices)
            {
                outgoing[vertex.Id] = new List<HalfEdgeBuilder>();
            }
            foreach (EdgeBuilder edge in edges)
            {
                var forward = new HalfEdgeBuilder
                {
                    Id = "h:" + edge.Id.Substring(2) + ":+",
                    Edge = edge,
                    Origin = edge.Start,
                    Destination = edge.End
                };
                var reverse = new HalfEdgeBuilder
                {
                    Id = "h:" + edge.Id.Substring(2) + ":-",
                    Edge = edge,
                    Origin = edge.End,
                    Destination = edge.Start
                };
                forward.Twin = reverse;
                reverse.Twin = forward;
                forward.Angle = Math.Atan2(
                    forward.Destination.Y - forward.Origin.Y,
                    forward.Destination.X - forward.Origin.X);
                reverse.Angle = Math.Atan2(
                    reverse.Destination.Y - reverse.Origin.Y,
                    reverse.Destination.X - reverse.Origin.X);
                halfEdges.Add(forward);
                halfEdges.Add(reverse);
                outgoing[forward.Origin.Id].Add(forward);
                outgoing[reverse.Origin.Id].Add(reverse);
            }
            foreach (List<HalfEdgeBuilder> values in outgoing.Values)
            {
                values.Sort(delegate(HalfEdgeBuilder left, HalfEdgeBuilder right)
                {
                    int compare = left.Angle.CompareTo(right.Angle);
                    return compare != 0 ? compare : string.CompareOrdinal(left.Id, right.Id);
                });
            }
            foreach (HalfEdgeBuilder halfEdge in halfEdges)
            {
                List<HalfEdgeBuilder> atDestination = outgoing[halfEdge.Destination.Id];
                int twinIndex = atDestination.IndexOf(halfEdge.Twin);
                if (twinIndex < 0 || atDestination.Count == 0)
                {
                    diagnostics.Add(new PlanarTopologyDiagnosticRecord(
                        "DCEL_TWIN_NOT_IN_OUTGOING",
                        "unsupported",
                        halfEdge.Id,
                        "Twin halfedge is missing from destination rotation system."));
                    continue;
                }
                halfEdge.Next = atDestination[(twinIndex - 1 + atDestination.Count) % atDestination.Count];
            }
            var rings = new List<RingBuilder>();
            var visited = new HashSet<string>(StringComparer.Ordinal);
            foreach (HalfEdgeBuilder seed in halfEdges)
            {
                if (visited.Contains(seed.Id) || seed.Next == null) { continue; }
                var ring = new RingBuilder
                {
                    Id = "ring:" + rings.Count.ToString("D7", CultureInfo.InvariantCulture)
                };
                HalfEdgeBuilder current = seed;
                int guard = 0;
                var ringVertexSet = new HashSet<string>(StringComparer.Ordinal);
                while (current != null && !visited.Contains(current.Id) && guard <= halfEdges.Count)
                {
                    visited.Add(current.Id);
                    current.RingId = ring.Id;
                    ring.HalfEdges.Add(current);
                    ring.Vertices.Add(current.Origin);
                    if (!ringVertexSet.Add(current.Origin.Id)) { ring.HasRepeatedVertex = true; }
                    ring.Perimeter += Distance(
                        current.Origin.X,
                        current.Origin.Y,
                        current.Destination.X,
                        current.Destination.Y);
                    current = current.Next;
                    guard++;
                    if (current == seed) { break; }
                }
                if (current != seed)
                {
                    diagnostics.Add(new PlanarTopologyDiagnosticRecord(
                        "DCEL_RING_DID_NOT_CLOSE",
                        "unsupported",
                        ring.Id,
                        "Halfedge next traversal failed to return to its seed."));
                }
                ring.SignedArea = SignedArea(ring.Vertices);
                SelectInteriorSample(ring, config.GridSize);
                rings.Add(ring);
            }
            var positive = new List<RingBuilder>();
            int negative = 0;
            int degenerate = 0;
            foreach (RingBuilder ring in rings)
            {
                if (ring.SignedArea > config.MinimumFaceArea)
                {
                    positive.Add(ring);
                }
                else if (ring.SignedArea < -config.MinimumFaceArea)
                {
                    negative++;
                }
                else
                {
                    degenerate++;
                }
            }
            ringCount = rings.Count;
            positiveRingCount = positive.Count;
            negativeRingCount = negative;
            degenerateRingCount = degenerate;
            combinatorialCycleRank = Math.Max(0, edges.Count - vertices.Count + componentCount);
            unresolvedCycleCount = Math.Max(0, combinatorialCycleRank - positive.Count);
            if (unresolvedCycleCount > 0)
            {
                diagnostics.Add(new PlanarTopologyDiagnosticRecord(
                    "DEGENERATE_OR_UNRESOLVED_FACE_CYCLES",
                    "ambiguous",
                    "",
                    unresolvedCycleCount.ToString(CultureInfo.InvariantCulture)
                        + " independent graph cycles do not bound a positive-area DCEL face."));
            }
            AssignRingParents(positive);
            faces = new List<PlanarFaceRecord>();
            foreach (RingBuilder ring in positive)
            {
                var outer = VertexIds(ring.Vertices, false);
                var holes = new List<List<string>>();
                double netArea = ring.SignedArea;
                foreach (RingBuilder child in ring.Children)
                {
                    holes.Add(VertexIds(child.Vertices, true));
                    netArea -= child.SignedArea;
                }
                string status = ring.HasRepeatedVertex
                    ? "computed_non_simple_boundary_walk"
                    : "computed";
                faces.Add(new PlanarFaceRecord(
                    "face:" + faces.Count.ToString("D7", CultureInfo.InvariantCulture),
                    outer,
                    holes,
                    ring.SignedArea,
                    Math.Max(0, netArea),
                    ring.Perimeter,
                    status));
            }
            halfEdgeRecords = new List<PlanarHalfEdgeRecord>();
            foreach (HalfEdgeBuilder halfEdge in halfEdges)
            {
                halfEdgeRecords.Add(new PlanarHalfEdgeRecord(
                    halfEdge.Id,
                    halfEdge.Edge.Id,
                    halfEdge.Origin.Id,
                    halfEdge.Destination.Id,
                    halfEdge.Twin == null ? "" : halfEdge.Twin.Id,
                    halfEdge.Next == null ? "" : halfEdge.Next.Id,
                    halfEdge.RingId));
            }
            validations = ValidateDcel(
                vertices.Count,
                edges.Count,
                componentCount,
                halfEdges,
                faces.Count,
                visited.Count,
                unresolvedCycleCount);
        }

        static List<PlanarTopologyValidationRecord> ValidateDcel(
            int vertexCount,
            int edgeCount,
            int componentCount,
            IList<HalfEdgeBuilder> halfEdges,
            int boundedFaceCount,
            int visitedCount,
            int unresolvedCycleCount)
        {
            bool twinPassed = true;
            bool nextPassed = true;
            var nextIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (HalfEdgeBuilder halfEdge in halfEdges)
            {
                if (halfEdge.Twin == null || halfEdge.Twin.Twin != halfEdge) { twinPassed = false; }
                if (halfEdge.Next == null || !nextIds.Add(halfEdge.Next.Id)) { nextPassed = false; }
            }
            int eulerLeft = vertexCount - edgeCount + boundedFaceCount + 1;
            int eulerRight = 1 + componentCount;
            return new List<PlanarTopologyValidationRecord>
            {
                new PlanarTopologyValidationRecord(
                    "halfedge_count_is_twice_edge_count",
                    halfEdges.Count == edgeCount * 2,
                    halfEdges.Count.ToString(CultureInfo.InvariantCulture),
                    (edgeCount * 2).ToString(CultureInfo.InvariantCulture)),
                new PlanarTopologyValidationRecord(
                    "twin_involution",
                    twinPassed,
                    twinPassed ? "all" : "failure",
                    "all"),
                new PlanarTopologyValidationRecord(
                    "next_is_permutation",
                    nextPassed && nextIds.Count == halfEdges.Count,
                    nextIds.Count.ToString(CultureInfo.InvariantCulture),
                    halfEdges.Count.ToString(CultureInfo.InvariantCulture)),
                new PlanarTopologyValidationRecord(
                    "all_halfedges_are_in_rings",
                    visitedCount == halfEdges.Count,
                    visitedCount.ToString(CultureInfo.InvariantCulture),
                    halfEdges.Count.ToString(CultureInfo.InvariantCulture)),
                new PlanarTopologyValidationRecord(
                    "euler_V_minus_E_plus_F_equals_1_plus_C",
                    eulerLeft == eulerRight,
                    eulerLeft.ToString(CultureInfo.InvariantCulture),
                    eulerRight.ToString(CultureInfo.InvariantCulture)),
                new PlanarTopologyValidationRecord(
                    "euler_gap_equals_unresolved_cycle_count",
                    eulerRight - eulerLeft == unresolvedCycleCount,
                    (eulerRight - eulerLeft).ToString(CultureInfo.InvariantCulture),
                    unresolvedCycleCount.ToString(CultureInfo.InvariantCulture))
            };
        }

        static void AssignRingParents(IList<RingBuilder> rings)
        {
            foreach (RingBuilder ring in rings)
            {
                RingBuilder parent = null;
                foreach (RingBuilder candidate in rings)
                {
                    if (candidate == ring || candidate.SignedArea <= ring.SignedArea) { continue; }
                    if (!PointInPolygon(ring.SampleX, ring.SampleY, candidate.Vertices)) { continue; }
                    if (parent == null || candidate.SignedArea < parent.SignedArea)
                    {
                        parent = candidate;
                    }
                }
                ring.Parent = parent;
                if (parent != null) { parent.Children.Add(ring); }
            }
        }

        static void SelectInteriorSample(RingBuilder ring, double gridSize)
        {
            for (int index = 0; index < ring.Vertices.Count; index++)
            {
                VertexBuilder a = ring.Vertices[index];
                VertexBuilder b = ring.Vertices[(index + 1) % ring.Vertices.Count];
                double dx = b.X - a.X;
                double dy = b.Y - a.Y;
                double length = Math.Sqrt(dx * dx + dy * dy);
                if (length <= 0) { continue; }
                double offset = Math.Min(length * 0.001, Math.Max(gridSize * 0.25, 0.0000001));
                ring.SampleX = (a.X + b.X) * 0.5 - dy / length * offset;
                ring.SampleY = (a.Y + b.Y) * 0.5 + dx / length * offset;
                return;
            }
        }

        static bool PointInPolygon(double x, double y, IList<VertexBuilder> polygon)
        {
            bool inside = false;
            for (int i = 0, j = polygon.Count - 1; i < polygon.Count; j = i++)
            {
                double xi = polygon[i].X;
                double yi = polygon[i].Y;
                double xj = polygon[j].X;
                double yj = polygon[j].Y;
                bool crosses = yi > y != yj > y
                    && x < (xj - xi) * (y - yi) / (yj - yi) + xi;
                if (crosses) { inside = !inside; }
            }
            return inside;
        }

        static List<string> VertexIds(IList<VertexBuilder> values, bool reverse)
        {
            var result = new List<string>();
            if (reverse)
            {
                for (int index = values.Count - 1; index >= 0; index--)
                {
                    result.Add(values[index].Id);
                }
            }
            else
            {
                foreach (VertexBuilder value in values) { result.Add(value.Id); }
            }
            return result;
        }

        static double SignedArea(IList<VertexBuilder> vertices)
        {
            double twice = 0;
            for (int index = 0; index < vertices.Count; index++)
            {
                VertexBuilder a = vertices[index];
                VertexBuilder b = vertices[(index + 1) % vertices.Count];
                twice += a.X * b.Y - b.X * a.Y;
            }
            return twice * 0.5;
        }

        static VertexBuilder VertexOf(
            IDictionary<string, VertexBuilder> values,
            double x,
            double y,
            double gridSize)
        {
            long gx = Quantize(x, gridSize);
            long gy = Quantize(y, gridSize);
            string key = gx.ToString(CultureInfo.InvariantCulture)
                + "," + gy.ToString(CultureInfo.InvariantCulture);
            VertexBuilder result;
            if (!values.TryGetValue(key, out result))
            {
                result = new VertexBuilder
                {
                    Key = key,
                    GridX = gx,
                    GridY = gy,
                    X = gx * gridSize,
                    Y = gy * gridSize
                };
                values[key] = result;
            }
            return result;
        }

        static Dictionary<string, List<int>> BuildSegmentGrid(
            IList<InputSegment> segments,
            double cell,
            int maxCellsPerSegment,
            out List<int> broad)
        {
            var result = new Dictionary<string, List<int>>(StringComparer.Ordinal);
            broad = new List<int>();
            foreach (InputSegment segment in segments)
            {
                long minX = FloorCell(segment.MinX, cell);
                long maxX = FloorCell(segment.MaxX, cell);
                long minY = FloorCell(segment.MinY, cell);
                long maxY = FloorCell(segment.MaxY, cell);
                double cellCount = (double)(maxX - minX + 1) * (maxY - minY + 1);
                if (cellCount > maxCellsPerSegment)
                {
                    broad.Add(segment.Index);
                    continue;
                }
                for (long x = minX; x <= maxX; x++)
                {
                    for (long y = minY; y <= maxY; y++)
                    {
                        string key = CellKey(x, y);
                        List<int> values;
                        if (!result.TryGetValue(key, out values))
                        {
                            values = new List<int>();
                            result[key] = values;
                        }
                        values.Add(segment.Index);
                    }
                }
            }
            return result;
        }

        static double AdaptiveCellSize(IList<InputSegment> segments, double minimum)
        {
            if (segments.Count == 0) { return minimum; }
            double minX = segments[0].MinX;
            double minY = segments[0].MinY;
            double maxX = segments[0].MaxX;
            double maxY = segments[0].MaxY;
            foreach (InputSegment segment in segments)
            {
                minX = Math.Min(minX, segment.MinX);
                minY = Math.Min(minY, segment.MinY);
                maxX = Math.Max(maxX, segment.MaxX);
                maxY = Math.Max(maxY, segment.MaxY);
            }
            double area = Math.Max(minimum * minimum, (maxX - minX) * (maxY - minY));
            double characteristic = Math.Sqrt(area / Math.Max(1, segments.Count));
            int sampleCount = Math.Min(4096, segments.Count);
            var sampledLengths = new List<double>(sampleCount);
            for (int index = 0; index < sampleCount; index++)
            {
                int sourceIndex = sampleCount == segments.Count
                    ? index
                    : (int)((long)index * segments.Count / sampleCount);
                InputSegment segment = segments[sourceIndex];
                sampledLengths.Add(Distance(
                    segment.Ax,
                    segment.Ay,
                    segment.Bx,
                    segment.By));
            }
            sampledLengths.Sort();
            double median = sampledLengths[sampledLengths.Count / 2];
            double segmentBound = median > 0 ? median * 4.0 : characteristic;
            return Math.Max(minimum, Math.Min(characteristic, segmentBound));
        }

        static bool IsSnapEligiblePathVertex(
            InstanceOccurrenceRecord occurrence,
            int segmentIndex,
            int segmentCount,
            bool isStart)
        {
            string quality = occurrence.GeometryQuality ?? "";
            bool approximated = quality.StartsWith("adaptive_", StringComparison.Ordinal)
                || quality.IndexOf("tessellation", StringComparison.OrdinalIgnoreCase) >= 0;
            if (!approximated)
            {
                return true;
            }
            if (occurrence.IsClosed)
            {
                return false;
            }
            return isStart ? segmentIndex == 0 : segmentIndex == segmentCount - 1;
        }

        static void SelectAuthoredRepresentative(SnapGroup group)
        {
            double cx = 0;
            double cy = 0;
            foreach (Endpoint endpoint in group.Members)
            {
                cx += endpoint.X;
                cy += endpoint.Y;
            }
            cx /= group.Members.Count;
            cy /= group.Members.Count;
            Endpoint best = null;
            double bestCentroid = double.MaxValue;
            double bestSum = double.MaxValue;
            foreach (Endpoint candidate in group.Members)
            {
                double centroid = Distance(candidate.X, candidate.Y, cx, cy);
                double sum = 0;
                foreach (Endpoint other in group.Members)
                {
                    sum += Distance(candidate.X, candidate.Y, other.X, other.Y);
                }
                if (best == null
                    || centroid < bestCentroid - 0.000000000001
                    || Math.Abs(centroid - bestCentroid) <= 0.000000000001
                        && (sum < bestSum - 0.000000000001
                            || Math.Abs(sum - bestSum) <= 0.000000000001
                                && string.CompareOrdinal(candidate.Id, best.Id) < 0))
                {
                    best = candidate;
                    bestCentroid = centroid;
                    bestSum = sum;
                }
            }
            group.OriginalX = best.X;
            group.OriginalY = best.Y;
            group.X = best.X;
            group.Y = best.Y;
        }

        static void ComputeMaxPairDistance(SnapGroup group)
        {
            double maximum = 0;
            for (int left = 0; left < group.Members.Count; left++)
            {
                for (int right = left + 1; right < group.Members.Count; right++)
                {
                    maximum = Math.Max(maximum, Distance(
                        group.Members[left].X,
                        group.Members[left].Y,
                        group.Members[right].X,
                        group.Members[right].Y));
                }
            }
            group.MaxPairDistance = maximum;
        }

        static string MinimumEndpointId(IList<Endpoint> values)
        {
            string result = null;
            foreach (Endpoint value in values)
            {
                if (result == null || string.CompareOrdinal(value.Id, result) < 0)
                {
                    result = value.Id;
                }
            }
            return result ?? "";
        }

        static double ProjectionDistance(
            double px,
            double py,
            double ax,
            double ay,
            double bx,
            double by,
            out double t,
            out double x,
            out double y)
        {
            double dx = bx - ax;
            double dy = by - ay;
            double lengthSquared = dx * dx + dy * dy;
            t = lengthSquared <= 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
            t = Clamp01(t);
            x = ax + dx * t;
            y = ay + dy * t;
            return Distance(px, py, x, y);
        }

        static List<double> Deduplicate(IList<double> values, double tolerance)
        {
            var result = new List<double>();
            foreach (double value in values)
            {
                if (result.Count == 0 || Math.Abs(value - result[result.Count - 1]) > tolerance)
                {
                    result.Add(value);
                }
            }
            return result;
        }

        static void AddParameter(IList<double> values, double value, double tolerance)
        {
            foreach (double existing in values)
            {
                if (Math.Abs(existing - value) <= tolerance) { return; }
            }
            values.Add(value);
        }

        static long Quantize(double value, double grid)
        {
            return checked((long)Math.Round(value / grid, MidpointRounding.AwayFromZero));
        }

        static long FloorCell(double value, double cell)
        {
            return checked((long)Math.Floor(value / cell));
        }

        static string CellKey(long x, long y)
        {
            return x.ToString(CultureInfo.InvariantCulture)
                + "," + y.ToString(CultureInfo.InvariantCulture);
        }

        static double Cross(double ax, double ay, double bx, double by)
        {
            return ax * by - ay * bx;
        }

        static double Distance(double ax, double ay, double bx, double by)
        {
            double dx = ax - bx;
            double dy = ay - by;
            return Math.Sqrt(dx * dx + dy * dy);
        }

        static double Clamp01(double value)
        {
            return Math.Max(0, Math.Min(1, value));
        }

        static double Lerp(double a, double b, double t)
        {
            return a + (b - a) * t;
        }

        static void Stage(
            IDictionary<string, double> values,
            string name,
            Stopwatch stopwatch)
        {
            values[name] = Math.Round(stopwatch.Elapsed.TotalMilliseconds, 3);
            stopwatch.Restart();
        }
    }

    internal static class PlanarMaps
    {
        public static Dictionary<string, object> Map(params object[] values)
        {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            for (int index = 0; index + 1 < values.Length; index += 2)
            {
                result[Convert.ToString(values[index], CultureInfo.InvariantCulture) ?? ""] =
                    values[index + 1];
            }
            return result;
        }
    }
}
