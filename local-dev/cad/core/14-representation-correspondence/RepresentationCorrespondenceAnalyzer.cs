using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace Shb.Cad.Core
{
    public sealed class RepresentationCorrespondenceConfig
    {
        public RepresentationCorrespondenceConfig()
        {
            MinimumFeatureStationCount = 3;
            MinimumStationCoverage = 0.6;
            AmbiguousStationCoverage = 0.4;
            StationToleranceRatio = 0.0125;
            MinimumStationTolerance = 0.000001;
            MinimumCrossAxisOverlap = 0.5;
            MaximumCenterResidualRatio = 0.08;
            MaximumExtentResidualRatio = 0.15;
            MinimumGeometrySimilarity = 0.94;
            CornerSineThreshold = 0.0871557427476582;
            SignatureQuantization = 0.0001;
            MaximumRegionCount = 500;
            MaximumPairEvaluationCount = 50000;
        }

        public int MinimumFeatureStationCount { get; set; }
        public double MinimumStationCoverage { get; set; }
        public double AmbiguousStationCoverage { get; set; }
        public double StationToleranceRatio { get; set; }
        public double MinimumStationTolerance { get; set; }
        public double MinimumCrossAxisOverlap { get; set; }
        public double MaximumCenterResidualRatio { get; set; }
        public double MaximumExtentResidualRatio { get; set; }
        public double MinimumGeometrySimilarity { get; set; }
        public double CornerSineThreshold { get; set; }
        public double SignatureQuantization { get; set; }
        public int MaximumRegionCount { get; set; }
        public int MaximumPairEvaluationCount { get; set; }
    }

    public sealed class RepresentationFeatureStationRecord
    {
        readonly List<string> vertexIds;

        internal RepresentationFeatureStationRecord(double coordinate, IEnumerable<string> vertices)
        {
            Coordinate = coordinate;
            vertexIds = vertices == null
                ? new List<string>()
                : vertices.Where(value => !string.IsNullOrEmpty(value))
                    .Distinct(StringComparer.Ordinal)
                    .OrderBy(value => value, StringComparer.Ordinal)
                    .ToList();
        }

        public double Coordinate { get; private set; }
        public IList<string> VertexIds { get { return vertexIds.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return RepresentationMaps.Map(
                "coordinate", Coordinate,
                "vertex_ids", new List<string>(vertexIds));
        }
    }

    public sealed class RepresentationRegionSignatureRecord
    {
        readonly List<double> normalizedEdgeLengths;
        readonly List<double> normalizedRadialDistances;
        readonly Dictionary<string, int> degreeHistogram;
        readonly List<RepresentationFeatureStationRecord> xStations;
        readonly List<RepresentationFeatureStationRecord> yStations;

        internal RepresentationRegionSignatureRecord(
            string regionId,
            string signatureId,
            string status,
            int vertexCount,
            int edgeCount,
            int faceCount,
            IEnumerable<double> edgeLengths,
            IEnumerable<double> radialDistances,
            IDictionary<string, int> degrees,
            IEnumerable<RepresentationFeatureStationRecord> xValues,
            IEnumerable<RepresentationFeatureStationRecord> yValues)
        {
            RegionId = regionId ?? "";
            SignatureId = signatureId ?? "";
            Status = status ?? "ambiguous";
            VertexCount = vertexCount;
            EdgeCount = edgeCount;
            FaceCount = faceCount;
            normalizedEdgeLengths = edgeLengths == null
                ? new List<double>()
                : edgeLengths.ToList();
            normalizedRadialDistances = radialDistances == null
                ? new List<double>()
                : radialDistances.ToList();
            degreeHistogram = degrees == null
                ? new Dictionary<string, int>(StringComparer.Ordinal)
                : new Dictionary<string, int>(degrees, StringComparer.Ordinal);
            xStations = xValues == null
                ? new List<RepresentationFeatureStationRecord>()
                : xValues.ToList();
            yStations = yValues == null
                ? new List<RepresentationFeatureStationRecord>()
                : yValues.ToList();
        }

        public string RegionId { get; private set; }
        public string SignatureId { get; private set; }
        public string Status { get; private set; }
        public int VertexCount { get; private set; }
        public int EdgeCount { get; private set; }
        public int FaceCount { get; private set; }
        public IList<double> NormalizedEdgeLengths { get { return normalizedEdgeLengths.AsReadOnly(); } }
        public IList<double> NormalizedRadialDistances { get { return normalizedRadialDistances.AsReadOnly(); } }
        public IDictionary<string, int> DegreeHistogram
        {
            get { return new Dictionary<string, int>(degreeHistogram, StringComparer.Ordinal); }
        }
        public IList<RepresentationFeatureStationRecord> XStations { get { return xStations.AsReadOnly(); } }
        public IList<RepresentationFeatureStationRecord> YStations { get { return yStations.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return RepresentationMaps.Map(
                "region_id", RegionId,
                "status", Status,
                "invariant_signature_id", SignatureId,
                "vertex_count", VertexCount,
                "edge_count", EdgeCount,
                "face_count", FaceCount,
                "normalized_edge_lengths", new List<double>(normalizedEdgeLengths),
                "normalized_radial_distances", new List<double>(normalizedRadialDistances),
                "degree_histogram", new Dictionary<string, int>(degreeHistogram),
                "x_feature_stations", xStations.Select(value => value.ToMap()).ToList(),
                "y_feature_stations", yStations.Select(value => value.ToMap()).ToList());
        }
    }

    public sealed class RepeatedRepresentationFamilyRecord
    {
        readonly List<string> regionIds;

        internal RepeatedRepresentationFamilyRecord(string id, string signatureId, IEnumerable<string> regions)
        {
            Id = id ?? "";
            SignatureId = signatureId ?? "";
            regionIds = regions == null
                ? new List<string>()
                : regions.Distinct(StringComparer.Ordinal)
                    .OrderBy(value => value, StringComparer.Ordinal)
                    .ToList();
        }

        public string Id { get; private set; }
        public string SignatureId { get; private set; }
        public IList<string> RegionIds { get { return regionIds.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return RepresentationMaps.Map(
                "family_id", Id,
                "invariant_signature_id", SignatureId,
                "region_ids", new List<string>(regionIds),
                "region_count", regionIds.Count,
                "identity_boundary", "same_geometry_supports_same_type_candidate_only_not_same_object");
        }
    }

    public sealed class ProjectionStationMatchRecord
    {
        readonly List<string> leftVertexIds;
        readonly List<string> rightVertexIds;

        internal ProjectionStationMatchRecord(
            double left,
            double right,
            IEnumerable<string> leftVertices,
            IEnumerable<string> rightVertices)
        {
            LeftCoordinate = left;
            RightCoordinate = right;
            Residual = Math.Abs(left - right);
            leftVertexIds = Copy(leftVertices);
            rightVertexIds = Copy(rightVertices);
        }

        public double LeftCoordinate { get; private set; }
        public double RightCoordinate { get; private set; }
        public double Residual { get; private set; }
        public IList<string> LeftVertexIds { get { return leftVertexIds.AsReadOnly(); } }
        public IList<string> RightVertexIds { get { return rightVertexIds.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return RepresentationMaps.Map(
                "left_coordinate", LeftCoordinate,
                "right_coordinate", RightCoordinate,
                "residual", Residual,
                "left_vertex_ids", new List<string>(leftVertexIds),
                "right_vertex_ids", new List<string>(rightVertexIds));
        }

        static List<string> Copy(IEnumerable<string> values)
        {
            return values == null
                ? new List<string>()
                : values.Where(value => !string.IsNullOrEmpty(value))
                    .Distinct(StringComparer.Ordinal)
                    .OrderBy(value => value, StringComparer.Ordinal)
                    .ToList();
        }
    }

    public sealed class RepresentationCorrespondenceRelationRecord
    {
        readonly List<ProjectionStationMatchRecord> stationMatches;

        internal RepresentationCorrespondenceRelationRecord(
            string id,
            string kind,
            string status,
            string leftRegionId,
            string rightRegionId,
            string layoutAxis,
            string sharedProjectionAxis,
            string signatureId,
            string identityInference,
            string sameObjectInference,
            double score,
            double geometrySimilarity,
            double stationTolerance,
            int leftStationCount,
            int rightStationCount,
            double leftCoverage,
            double rightCoverage,
            double crossAxisOverlap,
            double centerResidualRatio,
            double extentResidualRatio,
            IEnumerable<ProjectionStationMatchRecord> matches)
        {
            Id = id ?? "";
            Kind = kind ?? "";
            Status = status ?? "ambiguous";
            LeftRegionId = leftRegionId ?? "";
            RightRegionId = rightRegionId ?? "";
            LayoutAxis = layoutAxis ?? "";
            SharedProjectionAxis = sharedProjectionAxis ?? "";
            SignatureId = signatureId ?? "";
            IdentityInference = identityInference ?? "not_inferred";
            SameObjectInference = sameObjectInference ?? "not_supported";
            Score = score;
            GeometrySimilarity = geometrySimilarity;
            StationTolerance = stationTolerance;
            LeftStationCount = leftStationCount;
            RightStationCount = rightStationCount;
            LeftCoverage = leftCoverage;
            RightCoverage = rightCoverage;
            CrossAxisOverlapRatio = crossAxisOverlap;
            CenterResidualRatio = centerResidualRatio;
            ExtentResidualRatio = extentResidualRatio;
            stationMatches = matches == null
                ? new List<ProjectionStationMatchRecord>()
                : matches.ToList();
        }

        public string Id { get; private set; }
        public string Kind { get; private set; }
        public string Status { get; private set; }
        public string LeftRegionId { get; private set; }
        public string RightRegionId { get; private set; }
        public string LayoutAxis { get; private set; }
        public string SharedProjectionAxis { get; private set; }
        public string SignatureId { get; private set; }
        public string IdentityInference { get; private set; }
        public string SameObjectInference { get; private set; }
        public double Score { get; private set; }
        public double GeometrySimilarity { get; private set; }
        public double StationTolerance { get; private set; }
        public int LeftStationCount { get; private set; }
        public int RightStationCount { get; private set; }
        public int MatchedStationCount { get { return stationMatches.Count; } }
        public double LeftCoverage { get; private set; }
        public double RightCoverage { get; private set; }
        public double CrossAxisOverlapRatio { get; private set; }
        public double CenterResidualRatio { get; private set; }
        public double ExtentResidualRatio { get; private set; }
        public IList<ProjectionStationMatchRecord> StationMatches { get { return stationMatches.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return RepresentationMaps.Map(
                "relation_id", Id,
                "relation_kind", Kind,
                "status", Status,
                "left_region_id", LeftRegionId,
                "right_region_id", RightRegionId,
                "layout_axis", LayoutAxis,
                "shared_projection_axis", SharedProjectionAxis,
                "invariant_signature_id", SignatureId,
                "identity_inference", IdentityInference,
                "same_object_inference", SameObjectInference,
                "score", Score,
                "geometry_similarity", GeometrySimilarity,
                "station_tolerance", StationTolerance,
                "left_station_count", LeftStationCount,
                "right_station_count", RightStationCount,
                "matched_station_count", stationMatches.Count,
                "left_station_coverage", LeftCoverage,
                "right_station_coverage", RightCoverage,
                "cross_axis_overlap_ratio", CrossAxisOverlapRatio,
                "center_residual_ratio", CenterResidualRatio,
                "extent_residual_ratio", ExtentResidualRatio,
                "station_matches", stationMatches.Select(value => value.ToMap()).ToList());
        }
    }

    public sealed class RepresentationCorrespondenceDiagnosticRecord
    {
        internal RepresentationCorrespondenceDiagnosticRecord(
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
            return RepresentationMaps.Map(
                "code", Code,
                "status", Status,
                "source_id", SourceId,
                "message", Message);
        }
    }

    public sealed class RepresentationCorrespondenceDocument
    {
        readonly List<RepresentationRegionSignatureRecord> signatures;
        readonly List<RepeatedRepresentationFamilyRecord> families;
        readonly List<RepresentationCorrespondenceRelationRecord> relations;
        readonly List<RepresentationCorrespondenceDiagnosticRecord> diagnostics;

        internal RepresentationCorrespondenceDocument(
            string drawingId,
            int inputRegionCount,
            int evaluatedPairCount,
            IEnumerable<RepresentationRegionSignatureRecord> signatureValues,
            IEnumerable<RepeatedRepresentationFamilyRecord> familyValues,
            IEnumerable<RepresentationCorrespondenceRelationRecord> relationValues,
            IEnumerable<RepresentationCorrespondenceDiagnosticRecord> diagnosticValues)
        {
            DrawingId = drawingId ?? "";
            InputRegionCount = inputRegionCount;
            EvaluatedPairCount = evaluatedPairCount;
            signatures = signatureValues == null
                ? new List<RepresentationRegionSignatureRecord>()
                : signatureValues.ToList();
            families = familyValues == null
                ? new List<RepeatedRepresentationFamilyRecord>()
                : familyValues.ToList();
            relations = relationValues == null
                ? new List<RepresentationCorrespondenceRelationRecord>()
                : relationValues.ToList();
            diagnostics = diagnosticValues == null
                ? new List<RepresentationCorrespondenceDiagnosticRecord>()
                : diagnosticValues.ToList();
            RepeatedGeometryRelationCount = relations.Count(value =>
                value.Kind == "repeated_geometry_candidate"
                || value.Kind == "similar_geometry_candidate");
            OrthographicProjectionRelationCount = relations.Count(value =>
                value.Kind == "orthographic_projection_candidate");
            Status = diagnostics.Any(value => value.Status == "unsupported")
                ? "unsupported_partial"
                : diagnostics.Any(value => value.Status == "ambiguous")
                    ? "ambiguous"
                    : "computed";
        }

        public string DrawingId { get; private set; }
        public string Status { get; private set; }
        public int InputRegionCount { get; private set; }
        public int EvaluatedPairCount { get; private set; }
        public int RepeatedGeometryRelationCount { get; private set; }
        public int OrthographicProjectionRelationCount { get; private set; }
        public IList<RepresentationRegionSignatureRecord> RegionSignatures { get { return signatures.AsReadOnly(); } }
        public IList<RepeatedRepresentationFamilyRecord> RepeatedFamilies { get { return families.AsReadOnly(); } }
        public IList<RepresentationCorrespondenceRelationRecord> Relations { get { return relations.AsReadOnly(); } }
        public IList<RepresentationCorrespondenceDiagnosticRecord> Diagnostics { get { return diagnostics.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return RepresentationMaps.Map(
                "schema_version", "1",
                "analysis_type", "representation_correspondence",
                "analyzer_version", "1",
                "drawing_id", DrawingId,
                "status", Status,
                "input_engineering_region_count", InputRegionCount,
                "evaluated_pair_count", EvaluatedPairCount,
                "signature_count", signatures.Count,
                "repeated_family_count", families.Count,
                "repeated_geometry_relation_count", RepeatedGeometryRelationCount,
                "orthographic_projection_relation_count", OrthographicProjectionRelationCount,
                "region_signatures", signatures.Select(value => value.ToMap()).ToList(),
                "repeated_families", families.Select(value => value.ToMap()).ToList(),
                "relations", relations.Select(value => value.ToMap()).ToList(),
                "diagnostics", diagnostics.Select(value => value.ToMap()).ToList(),
                "semantic_contract", RepresentationMaps.Map(
                    "same_signature", "same_type_candidate_only",
                    "projection_alignment", "same_object_possible_not_proven",
                    "same_object_supported", false,
                    "view_direction_or_component_name", "not_inferred_without_independent_evidence"),
                "mutation_status", "read_only_no_entities_modified");
        }

        public string ToMarkdown()
        {
            var builder = new StringBuilder();
            builder.AppendLine("# 表达对应关系");
            builder.AppendLine();
            builder.AppendLine("- 图纸：`" + DrawingId + "`");
            builder.AppendLine("- 状态：`" + Status + "`");
            builder.AppendLine("- 工程区域 / 已评估区域对："
                + InputRegionCount.ToString(CultureInfo.InvariantCulture)
                + " / " + EvaluatedPairCount.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine("- 重复几何关系 / 正投影关系："
                + RepeatedGeometryRelationCount.ToString(CultureInfo.InvariantCulture)
                + " / " + OrthographicProjectionRelationCount.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine();
            builder.AppendLine("相同几何只支持同型候选；正投影站位对齐只支持同一对象的可能性。两者都不会单独触发对象合并。");
            return builder.ToString().TrimEnd();
        }
    }

    public static class RepresentationCorrespondenceAnalyzer
    {
        sealed class Incident
        {
            public PlanarEdgeRecord Edge;
            public PlanarVertexRecord Other;
        }

        sealed class RegionFeatures
        {
            public EngineeringViewRegionRecord Region;
            public RepresentationRegionSignatureRecord Signature;
            public readonly List<double> EdgeDistribution = new List<double>();
            public readonly List<double> RadialDistribution = new List<double>();
            public readonly Dictionary<string, int> DegreeHistogram = new Dictionary<string, int>(StringComparer.Ordinal);
        }

        sealed class LayoutEvidence
        {
            public string LayoutAxis;
            public string ProjectionAxis;
            public double CrossAxisOverlap;
            public double LeftMin;
            public double LeftMax;
            public double RightMin;
            public double RightMax;
            public IList<RepresentationFeatureStationRecord> LeftStations;
            public IList<RepresentationFeatureStationRecord> RightStations;
        }

        public static RepresentationCorrespondenceDocument Analyze(
            EngineeringViewRegionDocument regions,
            PlanarTopologyDocument topology,
            RepresentationCorrespondenceConfig config = null)
        {
            if (regions == null) { throw new ArgumentNullException("regions"); }
            if (topology == null) { throw new ArgumentNullException("topology"); }
            config = config ?? new RepresentationCorrespondenceConfig();
            ValidateConfig(config);
            var diagnostics = new List<RepresentationCorrespondenceDiagnosticRecord>();
            var candidates = regions.Regions
                .Where(value => value != null && value.IsEngineeringView)
                .OrderBy(value => value.Id, StringComparer.Ordinal)
                .ToList();
            int inputRegionCount = candidates.Count;
            if (candidates.Count > config.MaximumRegionCount)
            {
                candidates = candidates.Take(config.MaximumRegionCount).ToList();
                diagnostics.Add(new RepresentationCorrespondenceDiagnosticRecord(
                    "REGION_LIMIT_REACHED",
                    "unsupported",
                    "",
                    "Representation analysis was truncated at the configured engineering-region limit."));
            }

            var vertices = topology.Vertices.ToDictionary(value => value.Id, value => value, StringComparer.Ordinal);
            var edges = topology.Edges.ToDictionary(value => value.Id, value => value, StringComparer.Ordinal);
            var features = new List<RegionFeatures>();
            foreach (EngineeringViewRegionRecord region in candidates)
            {
                RegionFeatures value = BuildRegionFeatures(region, vertices, edges, config, diagnostics);
                if (value != null) { features.Add(value); }
            }

            var families = features
                .Where(value => !string.IsNullOrEmpty(value.Signature.SignatureId))
                .GroupBy(value => value.Signature.SignatureId, StringComparer.Ordinal)
                .Where(group => group.Count() > 1)
                .OrderBy(group => group.Key, StringComparer.Ordinal)
                .Select(group => new RepeatedRepresentationFamilyRecord(
                    "representation-family:" + Hash(new[] { group.Key }),
                    group.Key,
                    group.Select(value => value.Region.Id)))
                .ToList();

            var relations = new List<RepresentationCorrespondenceRelationRecord>();
            int evaluatedPairs = 0;
            bool pairLimitReached = false;
            for (int leftIndex = 0; leftIndex < features.Count && !pairLimitReached; leftIndex++)
            {
                for (int rightIndex = leftIndex + 1; rightIndex < features.Count; rightIndex++)
                {
                    if (evaluatedPairs >= config.MaximumPairEvaluationCount)
                    {
                        pairLimitReached = true;
                        break;
                    }
                    evaluatedPairs++;
                    RegionFeatures left = features[leftIndex];
                    RegionFeatures right = features[rightIndex];
                    double similarity = GeometrySimilarity(left, right);
                    if (!string.IsNullOrEmpty(left.Signature.SignatureId)
                        && left.Signature.SignatureId == right.Signature.SignatureId)
                    {
                        relations.Add(CreateGeometryRelation(
                            "repeated_geometry_candidate",
                            "supported_invariant_signature",
                            left,
                            right,
                            left.Signature.SignatureId,
                            1));
                    }
                    else if (similarity >= config.MinimumGeometrySimilarity)
                    {
                        relations.Add(CreateGeometryRelation(
                            "similar_geometry_candidate",
                            "ambiguous",
                            left,
                            right,
                            "",
                            similarity));
                    }

                    RepresentationCorrespondenceRelationRecord projection = CreateProjectionRelation(
                        left,
                        right,
                        similarity,
                        config);
                    if (projection != null) { relations.Add(projection); }
                }
            }
            if (pairLimitReached)
            {
                diagnostics.Add(new RepresentationCorrespondenceDiagnosticRecord(
                    "PAIR_EVALUATION_LIMIT_REACHED",
                    "unsupported",
                    "",
                    "Not all engineering-region pairs were evaluated."));
            }
            relations = relations
                .OrderBy(value => value.LeftRegionId, StringComparer.Ordinal)
                .ThenBy(value => value.RightRegionId, StringComparer.Ordinal)
                .ThenBy(value => value.Kind, StringComparer.Ordinal)
                .ToList();
            return new RepresentationCorrespondenceDocument(
                regions.DrawingId,
                inputRegionCount,
                evaluatedPairs,
                features.Select(value => value.Signature).ToList(),
                families,
                relations,
                diagnostics);
        }

        static RegionFeatures BuildRegionFeatures(
            EngineeringViewRegionRecord region,
            IDictionary<string, PlanarVertexRecord> vertices,
            IDictionary<string, PlanarEdgeRecord> edges,
            RepresentationCorrespondenceConfig config,
            IList<RepresentationCorrespondenceDiagnosticRecord> diagnostics)
        {
            var regionEdges = new List<PlanarEdgeRecord>();
            foreach (string edgeId in region.EdgeIds)
            {
                PlanarEdgeRecord edge;
                if (edges.TryGetValue(edgeId, out edge)) { regionEdges.Add(edge); }
            }
            var vertexIds = new HashSet<string>(region.VertexIds, StringComparer.Ordinal);
            foreach (PlanarEdgeRecord edge in regionEdges)
            {
                vertexIds.Add(edge.StartVertexId);
                vertexIds.Add(edge.EndVertexId);
            }
            var regionVertices = new List<PlanarVertexRecord>();
            foreach (string vertexId in vertexIds)
            {
                PlanarVertexRecord vertex;
                if (vertices.TryGetValue(vertexId, out vertex)) { regionVertices.Add(vertex); }
            }
            regionVertices = regionVertices.OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
            if (regionEdges.Count == 0 || regionVertices.Count == 0)
            {
                diagnostics.Add(new RepresentationCorrespondenceDiagnosticRecord(
                    "REGION_TOPOLOGY_EVIDENCE_MISSING",
                    "unsupported",
                    region.Id,
                    "An engineering-view region has no resolvable topology edge or vertex evidence."));
                return null;
            }

            var adjacency = new Dictionary<string, List<Incident>>(StringComparer.Ordinal);
            foreach (PlanarEdgeRecord edge in regionEdges)
            {
                PlanarVertexRecord start;
                PlanarVertexRecord end;
                if (!vertices.TryGetValue(edge.StartVertexId, out start)
                    || !vertices.TryGetValue(edge.EndVertexId, out end))
                {
                    continue;
                }
                AddIncident(adjacency, start.Id, edge, end);
                AddIncident(adjacency, end.Id, edge, start);
            }

            var result = new RegionFeatures { Region = region };
            List<double> lengths = regionEdges.Select(value => value.Length)
                .Where(value => value > 0)
                .OrderBy(value => value)
                .ToList();
            double maxLength = lengths.Count == 0 ? 1 : lengths[lengths.Count - 1];
            foreach (double length in lengths)
            {
                result.EdgeDistribution.Add(Quantize(length / maxLength, config.SignatureQuantization));
            }
            foreach (PlanarVertexRecord vertex in regionVertices)
            {
                List<Incident> incident;
                int degree = adjacency.TryGetValue(vertex.Id, out incident) ? incident.Count : 0;
                string key = degree.ToString(CultureInfo.InvariantCulture);
                int count;
                result.DegreeHistogram.TryGetValue(key, out count);
                result.DegreeHistogram[key] = count + 1;
            }
            double centerX = regionVertices.Average(value => value.X);
            double centerY = regionVertices.Average(value => value.Y);
            var distances = regionVertices.Select(value => Distance(centerX, centerY, value.X, value.Y))
                .OrderBy(value => value)
                .ToList();
            double maxDistance = distances.Count == 0 ? 1 : Math.Max(config.MinimumStationTolerance, distances[distances.Count - 1]);
            foreach (double distance in distances)
            {
                result.RadialDistribution.Add(Quantize(distance / maxDistance, config.SignatureQuantization));
            }

            List<PlanarVertexRecord> salient = regionVertices.Where(value =>
                IsSalient(value, adjacency, config.CornerSineThreshold)).ToList();
            if (salient.Count < 2) { salient = regionVertices; }
            double xMerge = Math.Max(config.MinimumStationTolerance, Math.Max(region.Width, 1) * 0.00000001);
            double yMerge = Math.Max(config.MinimumStationTolerance, Math.Max(region.Height, 1) * 0.00000001);
            List<RepresentationFeatureStationRecord> xStations = BuildStations(salient, true, xMerge);
            List<RepresentationFeatureStationRecord> yStations = BuildStations(salient, false, yMerge);
            string signaturePayload = BuildSignaturePayload(
                regionEdges.Count,
                regionVertices.Count,
                region.FaceCount,
                result.EdgeDistribution,
                result.RadialDistribution,
                result.DegreeHistogram);
            string signatureId = "representation-signature:" + Hash(new[] { signaturePayload });
            result.Signature = new RepresentationRegionSignatureRecord(
                region.Id,
                signatureId,
                "computed_invariant_topology_signature",
                regionVertices.Count,
                regionEdges.Count,
                region.FaceCount,
                result.EdgeDistribution,
                result.RadialDistribution,
                result.DegreeHistogram,
                xStations,
                yStations);
            return result;
        }

        static RepresentationCorrespondenceRelationRecord CreateGeometryRelation(
            string kind,
            string status,
            RegionFeatures left,
            RegionFeatures right,
            string signatureId,
            double similarity)
        {
            return new RepresentationCorrespondenceRelationRecord(
                "representation-relation:" + Hash(new[] { kind, left.Region.Id, right.Region.Id }),
                kind,
                status,
                left.Region.Id,
                right.Region.Id,
                "",
                "",
                signatureId,
                "same_type_candidate_only",
                "not_supported_by_geometry_repetition",
                similarity,
                similarity,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                0,
                new List<ProjectionStationMatchRecord>());
        }

        static RepresentationCorrespondenceRelationRecord CreateProjectionRelation(
            RegionFeatures left,
            RegionFeatures right,
            double geometrySimilarity,
            RepresentationCorrespondenceConfig config)
        {
            LayoutEvidence layout = DetermineLayout(left, right, config);
            if (layout == null) { return null; }
            double leftSpan = Math.Max(config.MinimumStationTolerance, layout.LeftMax - layout.LeftMin);
            double rightSpan = Math.Max(config.MinimumStationTolerance, layout.RightMax - layout.RightMin);
            double maxSpan = Math.Max(leftSpan, rightSpan);
            double tolerance = Math.Max(config.MinimumStationTolerance, maxSpan * config.StationToleranceRatio);
            List<ProjectionStationMatchRecord> matches = MatchStations(
                layout.LeftStations,
                layout.RightStations,
                tolerance);
            double leftCoverage = layout.LeftStations.Count == 0 ? 0 : (double)matches.Count / layout.LeftStations.Count;
            double rightCoverage = layout.RightStations.Count == 0 ? 0 : (double)matches.Count / layout.RightStations.Count;
            double minimumCoverage = Math.Min(leftCoverage, rightCoverage);
            double centerResidual = Math.Abs(
                (layout.LeftMin + layout.LeftMax) * 0.5
                - (layout.RightMin + layout.RightMax) * 0.5) / maxSpan;
            double extentResidual = (
                Math.Abs(layout.LeftMin - layout.RightMin)
                + Math.Abs(layout.LeftMax - layout.RightMax)) / (2 * maxSpan);
            bool enoughStations = matches.Count >= config.MinimumFeatureStationCount;
            bool supported = enoughStations
                && minimumCoverage >= config.MinimumStationCoverage
                && layout.CrossAxisOverlap >= config.MinimumCrossAxisOverlap
                && centerResidual <= config.MaximumCenterResidualRatio
                && extentResidual <= config.MaximumExtentResidualRatio;
            bool ambiguous = enoughStations
                && minimumCoverage >= config.AmbiguousStationCoverage
                && layout.CrossAxisOverlap >= config.MinimumCrossAxisOverlap;
            if (!supported && !ambiguous) { return null; }
            double score = Clamp(
                0.5 * ((leftCoverage + rightCoverage) * 0.5)
                + 0.2 * layout.CrossAxisOverlap
                + 0.15 * (1 - Clamp(centerResidual))
                + 0.15 * (1 - Clamp(extentResidual)));
            return new RepresentationCorrespondenceRelationRecord(
                "representation-relation:" + Hash(new[]
                {
                    "orthographic_projection_candidate",
                    left.Region.Id,
                    right.Region.Id,
                    layout.ProjectionAxis
                }),
                "orthographic_projection_candidate",
                supported ? "supported_geometry_relation" : "ambiguous",
                left.Region.Id,
                right.Region.Id,
                layout.LayoutAxis,
                layout.ProjectionAxis,
                "",
                supported ? "same_object_possible" : "not_inferred",
                supported ? "possible_not_proven" : "not_supported",
                score,
                geometrySimilarity,
                tolerance,
                layout.LeftStations.Count,
                layout.RightStations.Count,
                leftCoverage,
                rightCoverage,
                layout.CrossAxisOverlap,
                centerResidual,
                extentResidual,
                matches);
        }

        static LayoutEvidence DetermineLayout(
            RegionFeatures left,
            RegionFeatures right,
            RepresentationCorrespondenceConfig config)
        {
            EngineeringViewRegionRecord a = left.Region;
            EngineeringViewRegionRecord b = right.Region;
            double yOverlap = Overlap(a.MinY, a.MaxY, b.MinY, b.MaxY);
            double xOverlap = Overlap(a.MinX, a.MaxX, b.MinX, b.MaxX);
            double yOverlapRatio = yOverlap / Math.Max(config.MinimumStationTolerance, Math.Min(a.Height, b.Height));
            double xOverlapRatio = xOverlap / Math.Max(config.MinimumStationTolerance, Math.Min(a.Width, b.Width));
            bool horizontallySeparated = a.MaxX <= b.MinX || b.MaxX <= a.MinX;
            bool verticallySeparated = a.MaxY <= b.MinY || b.MaxY <= a.MinY;
            bool horizontal = horizontallySeparated && yOverlapRatio >= config.MinimumCrossAxisOverlap;
            bool vertical = verticallySeparated && xOverlapRatio >= config.MinimumCrossAxisOverlap;
            if (!horizontal && !vertical) { return null; }
            if (horizontal && (!vertical || yOverlapRatio >= xOverlapRatio))
            {
                return new LayoutEvidence
                {
                    LayoutAxis = "horizontal",
                    ProjectionAxis = "world_y",
                    CrossAxisOverlap = Clamp(yOverlapRatio),
                    LeftMin = a.MinY,
                    LeftMax = a.MaxY,
                    RightMin = b.MinY,
                    RightMax = b.MaxY,
                    LeftStations = left.Signature.YStations,
                    RightStations = right.Signature.YStations
                };
            }
            return new LayoutEvidence
            {
                LayoutAxis = "vertical",
                ProjectionAxis = "world_x",
                CrossAxisOverlap = Clamp(xOverlapRatio),
                LeftMin = a.MinX,
                LeftMax = a.MaxX,
                RightMin = b.MinX,
                RightMax = b.MaxX,
                LeftStations = left.Signature.XStations,
                RightStations = right.Signature.XStations
            };
        }

        static List<ProjectionStationMatchRecord> MatchStations(
            IList<RepresentationFeatureStationRecord> left,
            IList<RepresentationFeatureStationRecord> right,
            double tolerance)
        {
            var result = new List<ProjectionStationMatchRecord>();
            int leftIndex = 0;
            int rightIndex = 0;
            while (leftIndex < left.Count && rightIndex < right.Count)
            {
                RepresentationFeatureStationRecord a = left[leftIndex];
                RepresentationFeatureStationRecord b = right[rightIndex];
                double residual = a.Coordinate - b.Coordinate;
                if (Math.Abs(residual) <= tolerance)
                {
                    result.Add(new ProjectionStationMatchRecord(
                        a.Coordinate,
                        b.Coordinate,
                        a.VertexIds,
                        b.VertexIds));
                    leftIndex++;
                    rightIndex++;
                }
                else if (residual < 0) { leftIndex++; }
                else { rightIndex++; }
            }
            return result;
        }

        static double GeometrySimilarity(RegionFeatures left, RegionFeatures right)
        {
            double edgeDistribution = DistributionSimilarity(left.EdgeDistribution, right.EdgeDistribution);
            double radialDistribution = DistributionSimilarity(left.RadialDistribution, right.RadialDistribution);
            double edgeCount = CountSimilarity(left.Signature.EdgeCount, right.Signature.EdgeCount);
            double vertexCount = CountSimilarity(left.Signature.VertexCount, right.Signature.VertexCount);
            double faceCount = CountSimilarity(left.Signature.FaceCount, right.Signature.FaceCount);
            double degree = HistogramSimilarity(left.DegreeHistogram, right.DegreeHistogram);
            return Clamp(
                edgeDistribution * 0.3
                + radialDistribution * 0.25
                + degree * 0.2
                + edgeCount * 0.1
                + vertexCount * 0.1
                + faceCount * 0.05);
        }

        static double DistributionSimilarity(IList<double> left, IList<double> right)
        {
            if (left.Count == 0 && right.Count == 0) { return 1; }
            if (left.Count == 0 || right.Count == 0) { return 0; }
            // A fixed quantile sketch keeps pair evaluation bounded even when a view
            // contains tens of thousands of noded edges or tessellated vertices.
            int sampleCount = Math.Min(33, Math.Max(left.Count, right.Count));
            double difference = 0;
            for (int index = 0; index < sampleCount; index++)
            {
                double quantile = sampleCount == 1 ? 0 : (double)index / (sampleCount - 1);
                difference += Math.Abs(Quantile(left, quantile) - Quantile(right, quantile));
            }
            return Clamp(1 - difference / sampleCount);
        }

        static double Quantile(IList<double> values, double quantile)
        {
            if (values.Count == 1) { return values[0]; }
            double position = quantile * (values.Count - 1);
            int lower = (int)Math.Floor(position);
            int upper = Math.Min(values.Count - 1, lower + 1);
            double fraction = position - lower;
            return values[lower] * (1 - fraction) + values[upper] * fraction;
        }

        static double HistogramSimilarity(
            IDictionary<string, int> left,
            IDictionary<string, int> right)
        {
            var keys = new HashSet<string>(left.Keys, StringComparer.Ordinal);
            keys.UnionWith(right.Keys);
            int intersection = 0;
            int union = 0;
            foreach (string key in keys)
            {
                int a;
                int b;
                left.TryGetValue(key, out a);
                right.TryGetValue(key, out b);
                intersection += Math.Min(a, b);
                union += Math.Max(a, b);
            }
            return union == 0 ? 1 : (double)intersection / union;
        }

        static double CountSimilarity(int left, int right)
        {
            int maximum = Math.Max(left, right);
            return maximum == 0 ? 1 : (double)Math.Min(left, right) / maximum;
        }

        static List<RepresentationFeatureStationRecord> BuildStations(
            IList<PlanarVertexRecord> vertices,
            bool xAxis,
            double mergeTolerance)
        {
            var ordered = vertices
                .Select(value => new
                {
                    Vertex = value,
                    Coordinate = xAxis ? value.X : value.Y
                })
                .OrderBy(value => value.Coordinate)
                .ThenBy(value => value.Vertex.Id, StringComparer.Ordinal)
                .ToList();
            var result = new List<RepresentationFeatureStationRecord>();
            var coordinates = new List<double>();
            var ids = new List<string>();
            foreach (var value in ordered)
            {
                if (coordinates.Count > 0
                    && Math.Abs(value.Coordinate - coordinates.Average()) > mergeTolerance)
                {
                    result.Add(new RepresentationFeatureStationRecord(coordinates.Average(), ids));
                    coordinates.Clear();
                    ids.Clear();
                }
                coordinates.Add(value.Coordinate);
                ids.Add(value.Vertex.Id);
            }
            if (coordinates.Count > 0)
            {
                result.Add(new RepresentationFeatureStationRecord(coordinates.Average(), ids));
            }
            return result;
        }

        static bool IsSalient(
            PlanarVertexRecord vertex,
            IDictionary<string, List<Incident>> adjacency,
            double cornerSineThreshold)
        {
            List<Incident> incident;
            if (!adjacency.TryGetValue(vertex.Id, out incident) || incident.Count != 2)
            {
                return true;
            }
            double ax = incident[0].Other.X - vertex.X;
            double ay = incident[0].Other.Y - vertex.Y;
            double bx = incident[1].Other.X - vertex.X;
            double by = incident[1].Other.Y - vertex.Y;
            double denominator = Math.Sqrt((ax * ax + ay * ay) * (bx * bx + by * by));
            if (denominator <= 0) { return true; }
            double sine = Math.Abs(ax * by - ay * bx) / denominator;
            return sine >= cornerSineThreshold;
        }

        static void AddIncident(
            IDictionary<string, List<Incident>> adjacency,
            string vertexId,
            PlanarEdgeRecord edge,
            PlanarVertexRecord other)
        {
            List<Incident> values;
            if (!adjacency.TryGetValue(vertexId, out values))
            {
                values = new List<Incident>();
                adjacency[vertexId] = values;
            }
            values.Add(new Incident { Edge = edge, Other = other });
        }

        static string BuildSignaturePayload(
            int edgeCount,
            int vertexCount,
            int faceCount,
            IEnumerable<double> edgeLengths,
            IEnumerable<double> radialDistances,
            IDictionary<string, int> degreeHistogram)
        {
            return "e=" + edgeCount.ToString(CultureInfo.InvariantCulture)
                + ";v=" + vertexCount.ToString(CultureInfo.InvariantCulture)
                + ";f=" + faceCount.ToString(CultureInfo.InvariantCulture)
                + ";lengths=" + string.Join(",", edgeLengths.Select(Format).ToArray())
                + ";radial=" + string.Join(",", radialDistances.Select(Format).ToArray())
                + ";degrees=" + string.Join(",", degreeHistogram
                    .OrderBy(value => value.Key, StringComparer.Ordinal)
                    .Select(value => value.Key + ":" + value.Value.ToString(CultureInfo.InvariantCulture))
                    .ToArray());
        }

        static double Quantize(double value, double step)
        {
            return step > 0 ? Math.Round(value / step) * step : value;
        }

        static string Format(double value)
        {
            return value.ToString("G17", CultureInfo.InvariantCulture);
        }

        static double Overlap(double leftMin, double leftMax, double rightMin, double rightMax)
        {
            return Math.Max(0, Math.Min(leftMax, rightMax) - Math.Max(leftMin, rightMin));
        }

        static double Distance(double ax, double ay, double bx, double by)
        {
            double dx = bx - ax;
            double dy = by - ay;
            return Math.Sqrt(dx * dx + dy * dy);
        }

        static double Clamp(double value)
        {
            return Math.Max(0, Math.Min(1, value));
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

        static void ValidateConfig(RepresentationCorrespondenceConfig config)
        {
            if (config.MinimumFeatureStationCount <= 0) { throw new ArgumentOutOfRangeException("MinimumFeatureStationCount"); }
            if (config.MinimumStationCoverage < 0 || config.MinimumStationCoverage > 1) { throw new ArgumentOutOfRangeException("MinimumStationCoverage"); }
            if (config.AmbiguousStationCoverage < 0 || config.AmbiguousStationCoverage > config.MinimumStationCoverage)
            {
                throw new ArgumentOutOfRangeException("AmbiguousStationCoverage");
            }
            if (config.StationToleranceRatio < 0) { throw new ArgumentOutOfRangeException("StationToleranceRatio"); }
            if (config.MinimumStationTolerance <= 0) { throw new ArgumentOutOfRangeException("MinimumStationTolerance"); }
            if (config.MinimumCrossAxisOverlap < 0 || config.MinimumCrossAxisOverlap > 1) { throw new ArgumentOutOfRangeException("MinimumCrossAxisOverlap"); }
            if (config.MaximumCenterResidualRatio < 0) { throw new ArgumentOutOfRangeException("MaximumCenterResidualRatio"); }
            if (config.MaximumExtentResidualRatio < 0) { throw new ArgumentOutOfRangeException("MaximumExtentResidualRatio"); }
            if (config.MinimumGeometrySimilarity < 0 || config.MinimumGeometrySimilarity > 1) { throw new ArgumentOutOfRangeException("MinimumGeometrySimilarity"); }
            if (config.CornerSineThreshold < 0 || config.CornerSineThreshold > 1) { throw new ArgumentOutOfRangeException("CornerSineThreshold"); }
            if (config.SignatureQuantization <= 0) { throw new ArgumentOutOfRangeException("SignatureQuantization"); }
            if (config.MaximumRegionCount <= 0) { throw new ArgumentOutOfRangeException("MaximumRegionCount"); }
            if (config.MaximumPairEvaluationCount <= 0) { throw new ArgumentOutOfRangeException("MaximumPairEvaluationCount"); }
        }
    }

    internal static class RepresentationMaps
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
