using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace Shb.Cad.Core
{
    public sealed class EngineeringViewRegionConfig
    {
        readonly HashSet<string> excludedRoles;

        public EngineeringViewRegionConfig()
        {
            IncludePaperSpace = false;
            ExplicitClusterGap = 0;
            MinimumClusterGapRatio = 0.0015;
            MaximumClusterGapRatio = 0.03;
            AtomScaleGapMultiplier = 0.35;
            TextMarginRatio = 0.01;
            MinimumViewEdgeCount = 6;
            MinimumEngineeringViewSpanRatio = 0.015;
            MinimumRegionSpan = 0.001;
            DocumentationOverlapThreshold = 0.5;
            SheetStructureSpanRatio = 0.85;
            MaximumAtomCount = 100000;
            MaximumRegionCount = 10000;
            excludedRoles = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                "annotation_geometry",
                "center_reference",
                "double_chain_reference",
                "section_hatching"
            };
        }

        public bool IncludePaperSpace { get; set; }
        public double ExplicitClusterGap { get; set; }
        public double MinimumClusterGapRatio { get; set; }
        public double MaximumClusterGapRatio { get; set; }
        public double AtomScaleGapMultiplier { get; set; }
        public double TextMarginRatio { get; set; }
        public int MinimumViewEdgeCount { get; set; }
        public double MinimumEngineeringViewSpanRatio { get; set; }
        public double MinimumRegionSpan { get; set; }
        public double DocumentationOverlapThreshold { get; set; }
        public double SheetStructureSpanRatio { get; set; }
        public int MaximumAtomCount { get; set; }
        public int MaximumRegionCount { get; set; }
        public ISet<string> ExcludedRoles { get { return excludedRoles; } }

        internal bool IsRoleExcluded(string role)
        {
            return excludedRoles.Contains(role ?? "");
        }
    }

    public sealed class ViewRegionFrameObservation
    {
        readonly List<string> boundarySourceHandles;

        public ViewRegionFrameObservation(
            string id,
            double minX,
            double minY,
            double maxX,
            double maxY,
            IEnumerable<string> sourceHandles = null)
        {
            Id = id ?? "";
            MinX = Math.Min(minX, maxX);
            MinY = Math.Min(minY, maxY);
            MaxX = Math.Max(minX, maxX);
            MaxY = Math.Max(minY, maxY);
            boundarySourceHandles = sourceHandles == null
                ? new List<string>()
                : sourceHandles.Where(value => !string.IsNullOrEmpty(value))
                    .Distinct(StringComparer.OrdinalIgnoreCase)
                    .OrderBy(value => value, StringComparer.Ordinal)
                    .ToList();
        }

        public string Id { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }
        public double Width { get { return MaxX - MinX; } }
        public double Height { get { return MaxY - MinY; } }
        public IList<string> BoundarySourceHandles { get { return boundarySourceHandles.AsReadOnly(); } }
    }

    public sealed class ViewRegionTextObservation
    {
        public ViewRegionTextObservation(
            string id,
            string text,
            double minX,
            double minY,
            double maxX,
            double maxY,
            string kind = "drawing_text")
        {
            Id = id ?? "";
            Text = text ?? "";
            Kind = kind ?? "drawing_text";
            MinX = Math.Min(minX, maxX);
            MinY = Math.Min(minY, maxY);
            MaxX = Math.Max(minX, maxX);
            MaxY = Math.Max(minY, maxY);
        }

        public string Id { get; private set; }
        public string Text { get; private set; }
        public string Kind { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }
        public double CenterX { get { return (MinX + MaxX) * 0.5; } }
        public double CenterY { get { return (MinY + MaxY) * 0.5; } }
    }

    public sealed class KnownDocumentRegionObservation
    {
        public KnownDocumentRegionObservation(
            string id,
            string kind,
            double minX,
            double minY,
            double maxX,
            double maxY)
        {
            Id = id ?? "";
            Kind = kind ?? "documentation";
            MinX = Math.Min(minX, maxX);
            MinY = Math.Min(minY, maxY);
            MaxX = Math.Max(minX, maxX);
            MaxY = Math.Max(minY, maxY);
        }

        public string Id { get; private set; }
        public string Kind { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }
    }

    public sealed class ViewLocalFrameRecord
    {
        internal ViewLocalFrameRecord(
            double originX,
            double originY,
            double axisXx,
            double axisXy,
            double scale,
            double orthogonalCoverage,
            string scaleSource)
        {
            OriginX = originX;
            OriginY = originY;
            AxisXx = axisXx;
            AxisXy = axisXy;
            AxisYx = -axisXy;
            AxisYy = axisXx;
            Scale = scale;
            OrthogonalCoverage = orthogonalCoverage;
            ScaleSource = scaleSource ?? "";
        }

        public double OriginX { get; private set; }
        public double OriginY { get; private set; }
        public double AxisXx { get; private set; }
        public double AxisXy { get; private set; }
        public double AxisYx { get; private set; }
        public double AxisYy { get; private set; }
        public double Scale { get; private set; }
        public double OrthogonalCoverage { get; private set; }
        public string ScaleSource { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return ViewRegionMaps.Map(
                "origin", new[] { OriginX, OriginY },
                "axis_x", new[] { AxisXx, AxisXy },
                "axis_y", new[] { AxisYx, AxisYy },
                "scale", Scale,
                "scale_source", ScaleSource,
                "orthogonal_edge_length_coverage", OrthogonalCoverage);
        }
    }

    public sealed class EngineeringViewRegionRecord
    {
        readonly List<string> componentIds;
        readonly List<string> edgeIds;
        readonly List<string> vertexIds;
        readonly List<string> occurrenceIds;
        readonly List<string> labelIds;
        readonly List<string> labelTexts;
        readonly List<string> knownDocumentRegionIds;
        readonly Dictionary<string, int> roleCounts;

        internal EngineeringViewRegionRecord(
            string id,
            string kind,
            string subtype,
            string status,
            double minX,
            double minY,
            double maxX,
            double maxY,
            int faceCount,
            double topologyLength,
            IList<string> components,
            IList<string> edges,
            IList<string> vertices,
            IList<string> occurrences,
            IList<ViewRegionTextObservation> labels,
            IList<KnownDocumentRegionObservation> documents,
            IDictionary<string, int> roles,
            ViewLocalFrameRecord localFrame)
        {
            Id = id ?? "";
            Kind = kind ?? "auxiliary_geometry_cluster";
            Subtype = subtype ?? "unclassified";
            Status = status ?? "ambiguous";
            MinX = minX;
            MinY = minY;
            MaxX = maxX;
            MaxY = maxY;
            FaceCount = faceCount;
            TopologyLength = topologyLength;
            componentIds = SortedUnique(components);
            edgeIds = SortedUnique(edges);
            vertexIds = SortedUnique(vertices);
            occurrenceIds = SortedUnique(occurrences);
            labelIds = labels == null
                ? new List<string>()
                : SortedUnique(labels.Select(value => value.Id).ToList());
            labelTexts = labels == null
                ? new List<string>()
                : SortedUnique(labels.Select(value => value.Text).Where(value => !string.IsNullOrWhiteSpace(value)).ToList());
            knownDocumentRegionIds = documents == null
                ? new List<string>()
                : SortedUnique(documents.Select(value => value.Id).ToList());
            roleCounts = roles == null
                ? new Dictionary<string, int>(StringComparer.Ordinal)
                : new Dictionary<string, int>(roles, StringComparer.Ordinal);
            LocalFrame = localFrame;
        }

        public string Id { get; private set; }
        public string Kind { get; private set; }
        public string Subtype { get; private set; }
        public string Status { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }
        public double Width { get { return MaxX - MinX; } }
        public double Height { get { return MaxY - MinY; } }
        public double Area { get { return Math.Max(0, Width) * Math.Max(0, Height); } }
        public double CenterX { get { return (MinX + MaxX) * 0.5; } }
        public double CenterY { get { return (MinY + MaxY) * 0.5; } }
        public int FaceCount { get; private set; }
        public double TopologyLength { get; private set; }
        public ViewLocalFrameRecord LocalFrame { get; private set; }
        public IList<string> ComponentIds { get { return componentIds.AsReadOnly(); } }
        public IList<string> EdgeIds { get { return edgeIds.AsReadOnly(); } }
        public IList<string> VertexIds { get { return vertexIds.AsReadOnly(); } }
        public IList<string> OccurrenceIds { get { return occurrenceIds.AsReadOnly(); } }
        public IList<string> LabelIds { get { return labelIds.AsReadOnly(); } }
        public IList<string> LabelTexts { get { return labelTexts.AsReadOnly(); } }
        public IList<string> KnownDocumentRegionIds { get { return knownDocumentRegionIds.AsReadOnly(); } }
        public IDictionary<string, int> RoleCounts
        {
            get { return new Dictionary<string, int>(roleCounts, StringComparer.Ordinal); }
        }

        public bool IsEngineeringView
        {
            get
            {
                return Kind == "engineering_view_candidate"
                    || Kind == "detail_view_candidate"
                    || Kind == "section_view_candidate"
                    || Kind == "direction_view_candidate";
            }
        }

        public Dictionary<string, object> ToMap()
        {
            return ViewRegionMaps.Map(
                "region_id", Id,
                "region_kind", Kind,
                "region_subtype", Subtype,
                "status", Status,
                "bounds", new[] { MinX, MinY, MaxX, MaxY },
                "width", Width,
                "height", Height,
                "area", Area,
                "topology_length", TopologyLength,
                "component_count", componentIds.Count,
                "edge_count", edgeIds.Count,
                "vertex_count", vertexIds.Count,
                "face_count", FaceCount,
                "occurrence_count", occurrenceIds.Count,
                "component_ids", new List<string>(componentIds),
                "edge_ids", new List<string>(edgeIds),
                "vertex_ids", new List<string>(vertexIds),
                "occurrence_ids", new List<string>(occurrenceIds),
                "label_ids", new List<string>(labelIds),
                "label_texts", new List<string>(labelTexts),
                "known_document_region_ids", new List<string>(knownDocumentRegionIds),
                "role_counts", new Dictionary<string, int>(roleCounts),
                "local_frame", LocalFrame == null ? null : LocalFrame.ToMap());
        }

        static List<string> SortedUnique(IEnumerable<string> values)
        {
            return values == null
                ? new List<string>()
                : values.Where(value => !string.IsNullOrEmpty(value))
                    .Distinct(StringComparer.Ordinal)
                    .OrderBy(value => value, StringComparer.Ordinal)
                    .ToList();
        }
    }

    public sealed class EngineeringViewRegionDiagnosticRecord
    {
        internal EngineeringViewRegionDiagnosticRecord(
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
            return ViewRegionMaps.Map(
                "code", Code,
                "status", Status,
                "source_id", SourceId,
                "message", Message);
        }
    }

    public sealed class EngineeringViewRegionDocument
    {
        readonly List<EngineeringViewRegionRecord> regions;
        readonly List<EngineeringViewRegionDiagnosticRecord> diagnostics;
        readonly Dictionary<string, int> kindCounts;

        internal EngineeringViewRegionDocument(
            string drawingId,
            string frameId,
            double clusterGap,
            int eligibleOccurrenceCount,
            int atomCount,
            int unassignedOccurrenceCount,
            IList<EngineeringViewRegionRecord> values,
            IList<EngineeringViewRegionDiagnosticRecord> diagnosticValues)
        {
            DrawingId = drawingId ?? "";
            FrameId = frameId ?? "";
            ClusterGap = clusterGap;
            EligibleOccurrenceCount = eligibleOccurrenceCount;
            AtomCount = atomCount;
            UnassignedOccurrenceCount = unassignedOccurrenceCount;
            regions = values == null
                ? new List<EngineeringViewRegionRecord>()
                : new List<EngineeringViewRegionRecord>(values);
            diagnostics = diagnosticValues == null
                ? new List<EngineeringViewRegionDiagnosticRecord>()
                : new List<EngineeringViewRegionDiagnosticRecord>(diagnosticValues);
            kindCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (EngineeringViewRegionRecord region in regions)
            {
                int count;
                kindCounts.TryGetValue(region.Kind, out count);
                kindCounts[region.Kind] = count + 1;
                if (region.IsEngineeringView) { EngineeringViewCandidateCount++; }
                if (region.Kind == "documentation_region") { DocumentationRegionCount++; }
            }
            Status = diagnostics.Any(value => value.Status == "unsupported")
                ? "unsupported_partial"
                : diagnostics.Any(value => value.Status == "ambiguous")
                    ? "ambiguous"
                    : "computed";
        }

        public string DrawingId { get; private set; }
        public string FrameId { get; private set; }
        public string Status { get; private set; }
        public double ClusterGap { get; private set; }
        public int EligibleOccurrenceCount { get; private set; }
        public int AtomCount { get; private set; }
        public int UnassignedOccurrenceCount { get; private set; }
        public int EngineeringViewCandidateCount { get; private set; }
        public int DocumentationRegionCount { get; private set; }
        public IList<EngineeringViewRegionRecord> Regions { get { return regions.AsReadOnly(); } }
        public IList<EngineeringViewRegionDiagnosticRecord> Diagnostics { get { return diagnostics.AsReadOnly(); } }
        public IDictionary<string, int> KindCounts
        {
            get { return new Dictionary<string, int>(kindCounts, StringComparer.Ordinal); }
        }

        public Dictionary<string, object> ToMap()
        {
            return ViewRegionMaps.Map(
                "schema_version", "1",
                "analysis_type", "engineering_view_regions",
                "analyzer_version", "1",
                "drawing_id", DrawingId,
                "status", Status,
                "frame_id", FrameId,
                "cluster_gap", ClusterGap,
                "eligible_occurrence_count", EligibleOccurrenceCount,
                "region_atom_count", AtomCount,
                "region_count", regions.Count,
                "engineering_view_candidate_count", EngineeringViewCandidateCount,
                "documentation_region_count", DocumentationRegionCount,
                "unassigned_occurrence_count", UnassignedOccurrenceCount,
                "kind_counts", new Dictionary<string, int>(kindCounts),
                "regions", regions.Select(value => value.ToMap()).ToList(),
                "diagnostics", diagnostics.Select(value => value.ToMap()).ToList(),
                "semantic_contract", ViewRegionMaps.Map(
                    "scope_hierarchy", "drawing_to_spatial_cluster_to_topology_components",
                    "view_names", "authored_text_evidence_only",
                    "geometry_only_result", "candidate_not_business_identity",
                    "source_traceability", "region_to_component_edge_vertex_occurrence"),
                "mutation_status", "read_only_no_entities_modified");
        }

        public string ToMarkdown()
        {
            var builder = new StringBuilder();
            builder.AppendLine("# 工程视图与局部区域");
            builder.AppendLine();
            builder.AppendLine("- 图纸：`" + DrawingId + "`");
            builder.AppendLine("- 状态：`" + Status + "`");
            builder.AppendLine("- 区域原子 / 区域：" + AtomCount.ToString(CultureInfo.InvariantCulture)
                + " / " + regions.Count.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine("- 工程视图候选 / 文档区："
                + EngineeringViewCandidateCount.ToString(CultureInfo.InvariantCulture)
                + " / " + DocumentationRegionCount.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine("- 空间合并间距：" + ClusterGap.ToString("G17", CultureInfo.InvariantCulture));
            builder.AppendLine();
            builder.AppendLine("区域只表达确定性的空间 scope；主视、剖视、详图等名称只有在原图文字支持时才输出。无文字区域保留为候选，不猜构件身份。");
            return builder.ToString().TrimEnd();
        }
    }

    public static class EngineeringViewRegionAnalyzer
    {
        sealed class Atom
        {
            public string Id;
            public string ComponentId;
            public double MinX = double.PositiveInfinity;
            public double MinY = double.PositiveInfinity;
            public double MaxX = double.NegativeInfinity;
            public double MaxY = double.NegativeInfinity;
            public int FaceCount;
            public double TopologyLength;
            public readonly List<double> EdgeLengths = new List<double>();
            public readonly List<double> EdgeAngles = new List<double>();
            public readonly HashSet<string> EdgeIds = new HashSet<string>(StringComparer.Ordinal);
            public readonly HashSet<string> VertexIds = new HashSet<string>(StringComparer.Ordinal);
            public readonly HashSet<string> OccurrenceIds = new HashSet<string>(StringComparer.Ordinal);
            public readonly Dictionary<string, int> RoleCounts = new Dictionary<string, int>(StringComparer.Ordinal);

            public bool HasBounds { get { return !double.IsInfinity(MinX); } }
            public double Width { get { return MaxX - MinX; } }
            public double Height { get { return MaxY - MinY; } }

            public void AddPoint(string vertexId, double x, double y)
            {
                if (!string.IsNullOrEmpty(vertexId)) { VertexIds.Add(vertexId); }
                MinX = Math.Min(MinX, x);
                MinY = Math.Min(MinY, y);
                MaxX = Math.Max(MaxX, x);
                MaxY = Math.Max(MaxY, y);
            }

            public void AddOccurrence(InstanceOccurrenceRecord occurrence)
            {
                if (occurrence == null || !OccurrenceIds.Add(occurrence.Id)) { return; }
                int count;
                RoleCounts.TryGetValue(occurrence.SemanticRole ?? "", out count);
                RoleCounts[occurrence.SemanticRole ?? ""] = count + 1;
            }
        }

        sealed class DisjointSet
        {
            readonly int[] parent;

            public DisjointSet(int count)
            {
                parent = new int[count];
                for (int index = 0; index < count; index++) { parent[index] = index; }
            }

            public int Find(int value)
            {
                if (parent[value] != value) { parent[value] = Find(parent[value]); }
                return parent[value];
            }

            public void Union(int left, int right)
            {
                int a = Find(left);
                int b = Find(right);
                if (a == b) { return; }
                if (a < b) { parent[b] = a; }
                else { parent[a] = b; }
            }
        }

        public static EngineeringViewRegionDocument Analyze(
            BlockInstanceCoordinateDocument instances,
            PlanarTopologyDocument topology,
            ViewRegionFrameObservation frame = null,
            IEnumerable<ViewRegionTextObservation> textValues = null,
            IEnumerable<KnownDocumentRegionObservation> knownDocumentValues = null,
            EngineeringViewRegionConfig config = null)
        {
            if (instances == null) { throw new ArgumentNullException("instances"); }
            if (topology == null) { throw new ArgumentNullException("topology"); }
            config = config ?? new EngineeringViewRegionConfig();
            ValidateConfig(config);
            var diagnostics = new List<EngineeringViewRegionDiagnosticRecord>();
            var texts = textValues == null
                ? new List<ViewRegionTextObservation>()
                : textValues.Where(value => value != null).OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
            var knownDocuments = knownDocumentValues == null
                ? new List<KnownDocumentRegionObservation>()
                : knownDocumentValues.Where(value => value != null).OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
            var frameHandles = frame == null
                ? new HashSet<string>(StringComparer.OrdinalIgnoreCase)
                : new HashSet<string>(frame.BoundarySourceHandles, StringComparer.OrdinalIgnoreCase);
            if (frame == null)
            {
                diagnostics.Add(new EngineeringViewRegionDiagnosticRecord(
                    "DRAWING_FRAME_NOT_SUPPLIED",
                    "ambiguous",
                    "",
                    "Region scale and containment use eligible geometry bounds because no drawing frame was supplied."));
            }

            var eligible = new Dictionary<string, InstanceOccurrenceRecord>(StringComparer.Ordinal);
            foreach (InstanceOccurrenceRecord occurrence in instances.Occurrences)
            {
                if (!IsEligible(occurrence, frameHandles, config)) { continue; }
                eligible[occurrence.Id] = occurrence;
            }
            if (eligible.Count == 0)
            {
                diagnostics.Add(new EngineeringViewRegionDiagnosticRecord(
                    "NO_ELIGIBLE_STRUCTURAL_OCCURRENCES",
                    "unsupported",
                    "",
                    "No visible model-space structural curve occurrence is available for view-region analysis."));
                return new EngineeringViewRegionDocument(
                    instances.DrawingId,
                    frame == null ? "" : frame.Id,
                    0,
                    0,
                    0,
                    0,
                    new List<EngineeringViewRegionRecord>(),
                    diagnostics);
            }

            Dictionary<string, PlanarVertexRecord> vertices = topology.Vertices.ToDictionary(
                value => value.Id,
                value => value,
                StringComparer.Ordinal);
            var atomsByComponent = new Dictionary<string, Atom>(StringComparer.Ordinal);
            var assignedOccurrences = new HashSet<string>(StringComparer.Ordinal);
            foreach (PlanarEdgeRecord edge in topology.Edges)
            {
                var supports = edge.Supports
                    .Where(value => eligible.ContainsKey(value.OccurrenceId))
                    .ToList();
                if (supports.Count == 0) { continue; }
                string componentId = string.IsNullOrEmpty(edge.ComponentId)
                    ? "component:unassigned"
                    : edge.ComponentId;
                Atom atom;
                if (!atomsByComponent.TryGetValue(componentId, out atom))
                {
                    atom = new Atom { Id = "atom:" + componentId, ComponentId = componentId };
                    atomsByComponent[componentId] = atom;
                }
                PlanarVertexRecord start;
                PlanarVertexRecord end;
                if (!vertices.TryGetValue(edge.StartVertexId, out start)
                    || !vertices.TryGetValue(edge.EndVertexId, out end))
                {
                    diagnostics.Add(new EngineeringViewRegionDiagnosticRecord(
                        "EDGE_VERTEX_MISSING",
                        "unsupported",
                        edge.Id,
                        "A topology edge references a vertex absent from the topology document."));
                    continue;
                }
                atom.EdgeIds.Add(edge.Id);
                atom.AddPoint(start.Id, start.X, start.Y);
                atom.AddPoint(end.Id, end.X, end.Y);
                atom.TopologyLength += edge.Length;
                atom.EdgeLengths.Add(edge.Length);
                atom.EdgeAngles.Add(Math.Atan2(end.Y - start.Y, end.X - start.X));
                foreach (PlanarEdgeSupportRecord support in supports)
                {
                    InstanceOccurrenceRecord occurrence = eligible[support.OccurrenceId];
                    atom.AddOccurrence(occurrence);
                    assignedOccurrences.Add(occurrence.Id);
                }
            }
            foreach (PlanarFaceRecord face in topology.Faces)
            {
                if (face.OuterVertexIds.Count == 0) { continue; }
                PlanarVertexRecord vertex;
                if (!vertices.TryGetValue(face.OuterVertexIds[0], out vertex)) { continue; }
                Atom atom;
                if (!string.IsNullOrEmpty(vertex.ComponentId)
                    && atomsByComponent.TryGetValue(vertex.ComponentId, out atom))
                {
                    atom.FaceCount++;
                }
            }

            var atoms = atomsByComponent.Values.Where(value => value.HasBounds).ToList();
            foreach (InstanceOccurrenceRecord occurrence in eligible.Values)
            {
                if (assignedOccurrences.Contains(occurrence.Id) || !occurrence.HasBounds) { continue; }
                var atom = new Atom
                {
                    Id = "atom:orphan:" + occurrence.Id,
                    ComponentId = ""
                };
                atom.AddPoint("", occurrence.MinX, occurrence.MinY);
                atom.AddPoint("", occurrence.MaxX, occurrence.MaxY);
                atom.AddOccurrence(occurrence);
                atoms.Add(atom);
            }
            atoms.Sort(delegate(Atom left, Atom right) { return string.CompareOrdinal(left.Id, right.Id); });
            if (atoms.Count > config.MaximumAtomCount)
            {
                atoms = atoms.Take(config.MaximumAtomCount).ToList();
                diagnostics.Add(new EngineeringViewRegionDiagnosticRecord(
                    "REGION_ATOM_LIMIT_REACHED",
                    "unsupported",
                    "",
                    "Region analysis was truncated at the configured atom limit."));
            }

            double drawingMinX;
            double drawingMinY;
            double drawingMaxX;
            double drawingMaxY;
            if (frame != null)
            {
                drawingMinX = frame.MinX;
                drawingMinY = frame.MinY;
                drawingMaxX = frame.MaxX;
                drawingMaxY = frame.MaxY;
            }
            else
            {
                drawingMinX = atoms.Min(value => value.MinX);
                drawingMinY = atoms.Min(value => value.MinY);
                drawingMaxX = atoms.Max(value => value.MaxX);
                drawingMaxY = atoms.Max(value => value.MaxY);
            }
            double drawingDiagonal = Distance(drawingMinX, drawingMinY, drawingMaxX, drawingMaxY);
            var sheetStructureAtoms = new List<Atom>();
            var localAtoms = new List<Atom>();
            foreach (Atom atom in atoms)
            {
                if (IsSheetStructure(atom, frame, config)) { sheetStructureAtoms.Add(atom); }
                else { localAtoms.Add(atom); }
            }
            if (sheetStructureAtoms.Count > 0)
            {
                diagnostics.Add(new EngineeringViewRegionDiagnosticRecord(
                    "SHEET_SCALE_STRUCTURE_SEPARATED",
                    "computed",
                    "",
                    sheetStructureAtoms.Count.ToString(CultureInfo.InvariantCulture)
                        + " frame-scale topology component(s) were retained as sheet structure instead of gluing local views."));
            }
            double clusterGap = ResolveClusterGap(localAtoms, drawingDiagonal, config);
            List<List<Atom>> groups = ClusterAtoms(localAtoms, clusterGap);
            if (groups.Count > config.MaximumRegionCount)
            {
                groups = groups.Take(config.MaximumRegionCount).ToList();
                diagnostics.Add(new EngineeringViewRegionDiagnosticRecord(
                    "REGION_COUNT_LIMIT_REACHED",
                    "unsupported",
                    "",
                    "Region output was truncated at the configured region limit."));
            }

            double textMargin = Math.Max(clusterGap, drawingDiagonal * config.TextMarginRatio);
            double minimumEngineeringViewSpan =
                drawingDiagonal * config.MinimumEngineeringViewSpanRatio;
            var regions = new List<EngineeringViewRegionRecord>();
            foreach (List<Atom> group in groups)
            {
                EngineeringViewRegionRecord region = MaterializeRegion(
                    group,
                    texts,
                    knownDocuments,
                    textMargin,
                    minimumEngineeringViewSpan,
                    config);
                if (region != null) { regions.Add(region); }
            }
            foreach (Atom sheetAtom in sheetStructureAtoms)
            {
                EngineeringViewRegionRecord sheetRegion = MaterializeSheetStructure(sheetAtom);
                if (sheetRegion != null) { regions.Add(sheetRegion); }
            }
            var representedDocuments = new HashSet<string>(
                regions.SelectMany(value => value.KnownDocumentRegionIds),
                StringComparer.Ordinal);
            foreach (KnownDocumentRegionObservation document in knownDocuments)
            {
                if (representedDocuments.Contains(document.Id)) { continue; }
                EngineeringViewRegionRecord documentRegion = MaterializeKnownDocumentRegion(
                    document,
                    texts,
                    textMargin);
                if (documentRegion != null) { regions.Add(documentRegion); }
            }
            regions.Sort(delegate(EngineeringViewRegionRecord left, EngineeringViewRegionRecord right)
            {
                int compare = left.MinX.CompareTo(right.MinX);
                if (compare != 0) { return compare; }
                compare = left.MinY.CompareTo(right.MinY);
                return compare != 0 ? compare : string.CompareOrdinal(left.Id, right.Id);
            });
            var retainedOccurrenceIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (EngineeringViewRegionRecord region in regions)
            {
                retainedOccurrenceIds.UnionWith(region.OccurrenceIds);
            }
            int unassigned = eligible.Keys.Count(id => !retainedOccurrenceIds.Contains(id));
            if (unassigned > 0)
            {
                diagnostics.Add(new EngineeringViewRegionDiagnosticRecord(
                    "UNASSIGNED_STRUCTURAL_OCCURRENCES",
                    "ambiguous",
                    "",
                    unassigned.ToString(CultureInfo.InvariantCulture)
                        + " eligible occurrences were not retained after limits or degenerate-region filtering."));
            }
            return new EngineeringViewRegionDocument(
                instances.DrawingId,
                frame == null ? "" : frame.Id,
                clusterGap,
                eligible.Count,
                atoms.Count,
                unassigned,
                regions,
                diagnostics);
        }

        static EngineeringViewRegionRecord MaterializeRegion(
            IList<Atom> atoms,
            IList<ViewRegionTextObservation> allTexts,
            IList<KnownDocumentRegionObservation> allDocuments,
            double textMargin,
            double minimumEngineeringViewSpan,
            EngineeringViewRegionConfig config)
        {
            if (atoms == null || atoms.Count == 0) { return null; }
            double minX = atoms.Min(value => value.MinX);
            double minY = atoms.Min(value => value.MinY);
            double maxX = atoms.Max(value => value.MaxX);
            double maxY = atoms.Max(value => value.MaxY);
            if (Math.Max(maxX - minX, maxY - minY) < config.MinimumRegionSpan) { return null; }
            var components = atoms.Select(value => value.ComponentId).Where(value => !string.IsNullOrEmpty(value)).ToList();
            var edges = atoms.SelectMany(value => value.EdgeIds).Distinct(StringComparer.Ordinal).ToList();
            var vertices = atoms.SelectMany(value => value.VertexIds).Distinct(StringComparer.Ordinal).ToList();
            var occurrences = atoms.SelectMany(value => value.OccurrenceIds).Distinct(StringComparer.Ordinal).ToList();
            var labels = allTexts.Where(value =>
                value.CenterX >= minX - textMargin
                && value.CenterX <= maxX + textMargin
                && value.CenterY >= minY - textMargin
                && value.CenterY <= maxY + textMargin).ToList();
            var documents = allDocuments.Where(value =>
                OverlapRatio(
                    minX, minY, maxX, maxY,
                    value.MinX, value.MinY, value.MaxX, value.MaxY)
                    >= config.DocumentationOverlapThreshold).ToList();
            var roles = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (Atom atom in atoms)
            {
                foreach (KeyValuePair<string, int> pair in atom.RoleCounts)
                {
                    int count;
                    roles.TryGetValue(pair.Key, out count);
                    roles[pair.Key] = count + pair.Value;
                }
            }
            string allText = string.Join(" ", labels.Select(value => value.Text).ToArray());
            string kind;
            string subtype;
            string status;
            if (documents.Count > 0 || ContainsDocumentationKeyword(allText))
            {
                kind = "documentation_region";
                subtype = documents.Count == 0
                    ? "text_labeled_documentation"
                    : documents[0].Kind;
                status = documents.Count == 0
                    ? "supported_authored_text"
                    : "computed_known_document_region";
            }
            else if (ContainsAny(allText, "剖视", "剖面", "SECTION"))
            {
                kind = "section_view_candidate";
                subtype = "authored_section_label";
                status = "supported_authored_text";
            }
            else if (ContainsAny(allText, "详图", "局部", "DETAIL"))
            {
                kind = "detail_view_candidate";
                subtype = "authored_detail_label";
                status = "supported_authored_text";
            }
            else if (ContainsAny(allText, "向视图", "视图", "VIEW"))
            {
                kind = "direction_view_candidate";
                subtype = "authored_view_label";
                status = "supported_authored_text";
            }
            else if (edges.Count >= config.MinimumViewEdgeCount
                && Math.Max(maxX - minX, maxY - minY) >= minimumEngineeringViewSpan)
            {
                kind = "engineering_view_candidate";
                subtype = "geometry_scope_without_authored_view_name";
                status = "computed_geometry_scope";
            }
            else if (edges.Count >= 3)
            {
                kind = "local_geometry_region";
                subtype = "small_local_scope_not_promoted_to_drawing_view";
                status = "computed_geometry_scope";
            }
            else
            {
                kind = "auxiliary_geometry_cluster";
                subtype = "small_or_sparse_cluster";
                status = "ambiguous";
            }
            List<double> lengths = atoms.SelectMany(value => value.EdgeLengths).Where(value => value > 0).ToList();
            List<double> angles = atoms.SelectMany(value => value.EdgeAngles).ToList();
            ViewLocalFrameRecord localFrame = BuildLocalFrame(
                minX,
                minY,
                maxX,
                maxY,
                lengths,
                angles);
            string id = "view-region:" + Hash(
                atoms.Select(value => value.Id).OrderBy(value => value, StringComparer.Ordinal));
            return new EngineeringViewRegionRecord(
                id,
                kind,
                subtype,
                status,
                minX,
                minY,
                maxX,
                maxY,
                atoms.Sum(value => value.FaceCount),
                atoms.Sum(value => value.TopologyLength),
                components,
                edges,
                vertices,
                occurrences,
                labels,
                documents,
                roles,
                localFrame);
        }

        static EngineeringViewRegionRecord MaterializeSheetStructure(Atom atom)
        {
            if (atom == null || !atom.HasBounds) { return null; }
            var roles = new Dictionary<string, int>(atom.RoleCounts, StringComparer.Ordinal);
            ViewLocalFrameRecord localFrame = BuildLocalFrame(
                atom.MinX,
                atom.MinY,
                atom.MaxX,
                atom.MaxY,
                atom.EdgeLengths,
                atom.EdgeAngles);
            return new EngineeringViewRegionRecord(
                "view-region:" + Hash(new[] { "sheet_structure", atom.Id }),
                "sheet_structure_region",
                "frame_scale_topology_component",
                "computed_geometry_scope",
                atom.MinX,
                atom.MinY,
                atom.MaxX,
                atom.MaxY,
                atom.FaceCount,
                atom.TopologyLength,
                string.IsNullOrEmpty(atom.ComponentId)
                    ? new List<string>()
                    : new List<string> { atom.ComponentId },
                atom.EdgeIds.ToList(),
                atom.VertexIds.ToList(),
                atom.OccurrenceIds.ToList(),
                new List<ViewRegionTextObservation>(),
                new List<KnownDocumentRegionObservation>(),
                roles,
                localFrame);
        }

        static EngineeringViewRegionRecord MaterializeKnownDocumentRegion(
            KnownDocumentRegionObservation document,
            IList<ViewRegionTextObservation> texts,
            double textMargin)
        {
            if (document == null) { return null; }
            var labels = texts.Where(value =>
                value.CenterX >= document.MinX - textMargin
                && value.CenterX <= document.MaxX + textMargin
                && value.CenterY >= document.MinY - textMargin
                && value.CenterY <= document.MaxY + textMargin).ToList();
            ViewLocalFrameRecord localFrame = BuildLocalFrame(
                document.MinX,
                document.MinY,
                document.MaxX,
                document.MaxY,
                new List<double>(),
                new List<double>());
            return new EngineeringViewRegionRecord(
                "view-region:" + Hash(new[] { "known_document", document.Id }),
                "documentation_region",
                document.Kind,
                "computed_known_document_region",
                document.MinX,
                document.MinY,
                document.MaxX,
                document.MaxY,
                0,
                0,
                new List<string>(),
                new List<string>(),
                new List<string>(),
                new List<string>(),
                labels,
                new List<KnownDocumentRegionObservation> { document },
                new Dictionary<string, int>(StringComparer.Ordinal),
                localFrame);
        }

        static ViewLocalFrameRecord BuildLocalFrame(
            double minX,
            double minY,
            double maxX,
            double maxY,
            IList<double> lengths,
            IList<double> angles)
        {
            double sumCos = 0;
            double sumSin = 0;
            double total = 0;
            for (int index = 0; index < angles.Count && index < lengths.Count; index++)
            {
                double weight = lengths[index];
                sumCos += weight * Math.Cos(2 * angles[index]);
                sumSin += weight * Math.Sin(2 * angles[index]);
                total += weight;
            }
            double axisAngle = total > 0 ? 0.5 * Math.Atan2(sumSin, sumCos) : 0;
            double axisX = Math.Cos(axisAngle);
            double axisY = Math.Sin(axisAngle);
            if (axisX < 0 || Math.Abs(axisX) < 0.000000000001 && axisY < 0)
            {
                axisX = -axisX;
                axisY = -axisY;
            }
            double orthogonalWeight = 0;
            for (int index = 0; index < angles.Count && index < lengths.Count; index++)
            {
                double delta = AngleModuloHalfPi(angles[index] - axisAngle);
                if (delta <= Math.PI / 36.0) { orthogonalWeight += lengths[index]; }
            }
            double scale;
            string source;
            if (lengths.Count > 0)
            {
                var sorted = lengths.OrderBy(value => value).ToList();
                scale = Math.Max(0.000000001, sorted[sorted.Count / 2]);
                source = "median_topology_edge_length";
            }
            else
            {
                scale = Math.Max(0.000000001, Math.Min(maxX - minX, maxY - minY));
                source = "region_extent";
            }
            return new ViewLocalFrameRecord(
                (minX + maxX) * 0.5,
                (minY + maxY) * 0.5,
                axisX,
                axisY,
                scale,
                total > 0 ? orthogonalWeight / total : 0,
                source);
        }

        static List<List<Atom>> ClusterAtoms(IList<Atom> atoms, double gap)
        {
            var order = Enumerable.Range(0, atoms.Count)
                .OrderBy(index => atoms[index].MinX)
                .ThenBy(index => atoms[index].MinY)
                .ThenBy(index => atoms[index].Id, StringComparer.Ordinal)
                .ToList();
            var dsu = new DisjointSet(atoms.Count);
            var active = new List<int>();
            foreach (int index in order)
            {
                Atom current = atoms[index];
                active = active.Where(other => atoms[other].MaxX + gap >= current.MinX - gap).ToList();
                foreach (int other in active)
                {
                    if (BoxesWithin(atoms[other], current, gap)) { dsu.Union(index, other); }
                }
                active.Add(index);
            }
            var groups = new Dictionary<int, List<Atom>>();
            for (int index = 0; index < atoms.Count; index++)
            {
                int root = dsu.Find(index);
                List<Atom> values;
                if (!groups.TryGetValue(root, out values))
                {
                    values = new List<Atom>();
                    groups[root] = values;
                }
                values.Add(atoms[index]);
            }
            return groups.Values
                .Select(values => values.OrderBy(value => value.Id, StringComparer.Ordinal).ToList())
                .OrderBy(values => values.Min(value => value.MinX))
                .ThenBy(values => values.Min(value => value.MinY))
                .ToList();
        }

        static bool IsSheetStructure(
            Atom atom,
            ViewRegionFrameObservation frame,
            EngineeringViewRegionConfig config)
        {
            if (atom == null || frame == null || frame.Width <= 0 || frame.Height <= 0)
            {
                return false;
            }
            return atom.Width >= frame.Width * config.SheetStructureSpanRatio
                && atom.Height >= frame.Height * config.SheetStructureSpanRatio;
        }

        static bool BoxesWithin(Atom left, Atom right, double gap)
        {
            return !(left.MaxX + gap < right.MinX - gap
                || right.MaxX + gap < left.MinX - gap
                || left.MaxY + gap < right.MinY - gap
                || right.MaxY + gap < left.MinY - gap);
        }

        static double ResolveClusterGap(
            IList<Atom> atoms,
            double drawingDiagonal,
            EngineeringViewRegionConfig config)
        {
            if (config.ExplicitClusterGap > 0) { return config.ExplicitClusterGap; }
            var spans = atoms.Select(value => Math.Max(value.Width, value.Height))
                .Where(value => value > config.MinimumRegionSpan)
                .OrderBy(value => value)
                .ToList();
            double atomScale = spans.Count == 0 ? 0 : spans[spans.Count / 2];
            double minimum = drawingDiagonal * config.MinimumClusterGapRatio;
            double maximum = drawingDiagonal * config.MaximumClusterGapRatio;
            double proposed = Math.Max(minimum, atomScale * config.AtomScaleGapMultiplier);
            return maximum > 0 ? Math.Min(maximum, proposed) : proposed;
        }

        static bool IsEligible(
            InstanceOccurrenceRecord occurrence,
            ISet<string> frameHandles,
            EngineeringViewRegionConfig config)
        {
            if (occurrence == null || !occurrence.HasWorldPath || !occurrence.Visible) { return false; }
            if (!config.IncludePaperSpace
                && (occurrence.RootDefinitionName ?? "").IndexOf("MODEL_SPACE", StringComparison.OrdinalIgnoreCase) < 0
                && (occurrence.RootDefinitionName ?? "").IndexOf("Model_Space", StringComparison.OrdinalIgnoreCase) < 0)
            {
                return false;
            }
            if (config.IsRoleExcluded(occurrence.SemanticRole)) { return false; }
            if (frameHandles.Contains(occurrence.SourceHandle)) { return false; }
            return true;
        }

        static bool ContainsDocumentationKeyword(string value)
        {
            return ContainsAny(
                value,
                "技术要求",
                "明细表",
                "标题栏",
                "材料表",
                "代号",
                "DOCUMENT",
                "SCHEDULE",
                "TITLE BLOCK");
        }

        static bool ContainsAny(string value, params string[] needles)
        {
            value = value ?? "";
            foreach (string needle in needles)
            {
                if (value.IndexOf(needle, StringComparison.OrdinalIgnoreCase) >= 0) { return true; }
            }
            return false;
        }

        static double OverlapRatio(
            double aMinX,
            double aMinY,
            double aMaxX,
            double aMaxY,
            double bMinX,
            double bMinY,
            double bMaxX,
            double bMaxY)
        {
            double width = Math.Max(0, Math.Min(aMaxX, bMaxX) - Math.Max(aMinX, bMinX));
            double height = Math.Max(0, Math.Min(aMaxY, bMaxY) - Math.Max(aMinY, bMinY));
            double intersection = width * height;
            double aArea = Math.Max(0, aMaxX - aMinX) * Math.Max(0, aMaxY - aMinY);
            double bArea = Math.Max(0, bMaxX - bMinX) * Math.Max(0, bMaxY - bMinY);
            double denominator = Math.Min(aArea, bArea);
            return denominator > 0 ? intersection / denominator : 0;
        }

        static double AngleModuloHalfPi(double value)
        {
            value = Math.Abs(value) % (Math.PI * 0.5);
            return Math.Min(value, Math.PI * 0.5 - value);
        }

        static double Distance(double ax, double ay, double bx, double by)
        {
            double dx = bx - ax;
            double dy = by - ay;
            return Math.Sqrt(dx * dx + dy * dy);
        }

        static string Hash(IEnumerable<string> values)
        {
            string payload = string.Join("\n", values.ToArray());
            using (SHA256 algorithm = SHA256.Create())
            {
                byte[] hash = algorithm.ComputeHash(Encoding.UTF8.GetBytes(payload));
                var builder = new StringBuilder(24);
                for (int index = 0; index < 12; index++)
                {
                    builder.Append(hash[index].ToString("x2", CultureInfo.InvariantCulture));
                }
                return builder.ToString();
            }
        }

        static void ValidateConfig(EngineeringViewRegionConfig config)
        {
            if (config.MinimumClusterGapRatio < 0) { throw new ArgumentOutOfRangeException("MinimumClusterGapRatio"); }
            if (config.MaximumClusterGapRatio < config.MinimumClusterGapRatio)
            {
                throw new ArgumentException("MaximumClusterGapRatio must not be smaller than MinimumClusterGapRatio.");
            }
            if (config.MaximumAtomCount <= 0) { throw new ArgumentOutOfRangeException("MaximumAtomCount"); }
            if (config.MaximumRegionCount <= 0) { throw new ArgumentOutOfRangeException("MaximumRegionCount"); }
            if (config.MinimumViewEdgeCount <= 0) { throw new ArgumentOutOfRangeException("MinimumViewEdgeCount"); }
            if (config.MinimumEngineeringViewSpanRatio < 0)
            {
                throw new ArgumentOutOfRangeException("MinimumEngineeringViewSpanRatio");
            }
            if (config.SheetStructureSpanRatio <= 0 || config.SheetStructureSpanRatio > 1)
            {
                throw new ArgumentOutOfRangeException("SheetStructureSpanRatio");
            }
        }
    }

    internal static class ViewRegionMaps
    {
        public static Dictionary<string, object> Map(params object[] pairs)
        {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            for (int index = 0; index + 1 < pairs.Length; index += 2)
            {
                result[(string)pairs[index]] = pairs[index + 1];
            }
            return result;
        }
    }
}
