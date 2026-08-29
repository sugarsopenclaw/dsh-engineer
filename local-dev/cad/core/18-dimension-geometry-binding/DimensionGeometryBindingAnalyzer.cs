using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;

namespace Shb.Cad.Core
{
    public sealed class DimensionGeometryBindingConfig
    {
        public DimensionGeometryBindingConfig()
        {
            EndpointToleranceRatio = 0.00001;
            CandidateTieToleranceRatio = 0.01;
            AbsoluteComparisonTolerance = 0.05;
            RelativeComparisonTolerance = 0.000001;
            PlanarZTolerance = 0.001;
            MaximumPlacementCount = 10000;
            MaximumIndexedEdgeCount = 1000000;
            MaximumCandidatesPerEndpoint = 8;
            MaximumCandidateCombinations = 64;
            MaximumIndexCellsPerEdge = 4096;
            ScaleRatioRelativeTolerance = 0.005;
            MinimumScaleHypothesisSupport = 3;
            MinimumNonUnitScaleDifference = 0.01;
        }

        public double EndpointToleranceRatio { get; set; }
        public double CandidateTieToleranceRatio { get; set; }
        public double AbsoluteComparisonTolerance { get; set; }
        public double RelativeComparisonTolerance { get; set; }
        public double PlanarZTolerance { get; set; }
        public int MaximumPlacementCount { get; set; }
        public int MaximumIndexedEdgeCount { get; set; }
        public int MaximumCandidatesPerEndpoint { get; set; }
        public int MaximumCandidateCombinations { get; set; }
        public int MaximumIndexCellsPerEdge { get; set; }
        public double ScaleRatioRelativeTolerance { get; set; }
        public int MinimumScaleHypothesisSupport { get; set; }
        public double MinimumNonUnitScaleDifference { get; set; }
    }

    public sealed class DimensionGeometryPlacementObservation
    {
        readonly List<string> instancePath;

        internal DimensionGeometryPlacementObservation(
            DimensionEdgeRecord edge,
            string occurrenceId,
            string sourceDefinitionHandle,
            string sourceDefinitionName,
            IEnumerable<string> path,
            InstanceAffineTransformObservation transform,
            bool visible,
            string occurrenceStatus)
        {
            if (edge == null) { throw new ArgumentNullException("edge"); }
            transform = transform ?? InstanceAffineTransformObservation.Identity;
            DimensionHandle = edge.Handle;
            DimensionEdgeId = edge.Id;
            OccurrenceId = occurrenceId ?? "";
            SourceDefinitionHandle = sourceDefinitionHandle ?? "";
            SourceDefinitionName = sourceDefinitionName ?? "";
            OwnerScope = edge.OwnerScope;
            OwnerBlockName = edge.OwnerBlockName;
            Visible = visible;
            SourceOccurrenceStatus = occurrenceStatus ?? "";
            instancePath = DimensionGeometryBindingMaps.SortedUniquePreserveOrder(path);

            InstancePoint3Observation first = transform.Transform(
                new InstancePoint3Observation(edge.XLine1X, edge.XLine1Y, 0));
            InstancePoint3Observation second = transform.Transform(
                new InstancePoint3Observation(edge.XLine2X, edge.XLine2Y, 0));
            InstancePoint3Observation line = transform.Transform(
                new InstancePoint3Observation(edge.DimensionLineX, edge.DimensionLineY, 0));
            XLine1X = first == null ? 0 : first.X;
            XLine1Y = first == null ? 0 : first.Y;
            XLine1Z = first == null ? 0 : first.Z;
            XLine2X = second == null ? 0 : second.X;
            XLine2Y = second == null ? 0 : second.Y;
            XLine2Z = second == null ? 0 : second.Z;
            DimensionLineX = line == null ? 0 : line.X;
            DimensionLineY = line == null ? 0 : line.Y;

            double transformedAxisX = transform[0, 0] * edge.AxisX
                + transform[0, 1] * edge.AxisY;
            double transformedAxisY = transform[1, 0] * edge.AxisX
                + transform[1, 1] * edge.AxisY;
            AxisScale = Math.Sqrt(transformedAxisX * transformedAxisX
                + transformedAxisY * transformedAxisY);
            if (AxisScale > 0 && IsFinite(AxisScale))
            {
                AxisX = transformedAxisX / AxisScale;
                AxisY = transformedAxisY / AxisScale;
                IsTransformUsable = true;
                WorldDefinitionSpan = Math.Abs(
                    (XLine2X - XLine1X) * AxisX
                    + (XLine2Y - XLine1Y) * AxisY);
            }
            else
            {
                AxisX = 0;
                AxisY = 0;
                WorldDefinitionSpan = 0;
            }
            IsMirrored = transform.IsMirrored;
        }

        public string DimensionHandle { get; private set; }
        public string DimensionEdgeId { get; private set; }
        public string OccurrenceId { get; private set; }
        public string SourceDefinitionHandle { get; private set; }
        public string SourceDefinitionName { get; private set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public bool Visible { get; private set; }
        public string SourceOccurrenceStatus { get; private set; }
        public IList<string> InstancePath { get { return instancePath.AsReadOnly(); } }
        public double XLine1X { get; private set; }
        public double XLine1Y { get; private set; }
        public double XLine1Z { get; private set; }
        public double XLine2X { get; private set; }
        public double XLine2Y { get; private set; }
        public double XLine2Z { get; private set; }
        public double DimensionLineX { get; private set; }
        public double DimensionLineY { get; private set; }
        public double AxisX { get; private set; }
        public double AxisY { get; private set; }
        public double AxisScale { get; private set; }
        public double WorldDefinitionSpan { get; private set; }
        public bool IsMirrored { get; private set; }
        public bool IsTransformUsable { get; private set; }

        static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }

    public sealed class DimensionGeometryAnchorCandidateRecord
    {
        readonly List<string> edgeIds;
        readonly List<string> regionIds;
        readonly List<string> profileIds;
        readonly List<string> interfaceFeatureIds;
        readonly List<string> objectClusterIds;
        readonly List<string> sourceHandles;
        readonly List<string> geometryQualities;

        internal DimensionGeometryAnchorCandidateRecord(
            string id,
            string kind,
            string vertexId,
            IEnumerable<string> edges,
            double x,
            double y,
            double distance,
            double tolerance,
            IEnumerable<string> regions,
            IEnumerable<string> profiles,
            IEnumerable<string> features,
            IEnumerable<string> objects,
            IEnumerable<string> handles,
            IEnumerable<string> qualities)
        {
            Id = id ?? "";
            TargetKind = kind ?? "topology_anchor_candidate";
            VertexId = vertexId ?? "";
            edgeIds = DimensionGeometryBindingMaps.SortedUnique(edges);
            X = x;
            Y = y;
            Distance = distance;
            Tolerance = tolerance;
            regionIds = DimensionGeometryBindingMaps.SortedUnique(regions);
            profileIds = DimensionGeometryBindingMaps.SortedUnique(profiles);
            interfaceFeatureIds = DimensionGeometryBindingMaps.SortedUnique(features);
            objectClusterIds = DimensionGeometryBindingMaps.SortedUnique(objects);
            sourceHandles = DimensionGeometryBindingMaps.SortedUnique(handles);
            geometryQualities = DimensionGeometryBindingMaps.SortedUnique(qualities);
        }

        public string Id { get; private set; }
        public string TargetKind { get; private set; }
        public string VertexId { get; private set; }
        public IList<string> EdgeIds { get { return edgeIds.AsReadOnly(); } }
        public double X { get; private set; }
        public double Y { get; private set; }
        public double Distance { get; private set; }
        public double Tolerance { get; private set; }
        public IList<string> RegionIds { get { return regionIds.AsReadOnly(); } }
        public IList<string> ProfileIds { get { return profileIds.AsReadOnly(); } }
        public IList<string> InterfaceFeatureIds { get { return interfaceFeatureIds.AsReadOnly(); } }
        public IList<string> PhysicalObjectClusterIds { get { return objectClusterIds.AsReadOnly(); } }
        public IList<string> SourceHandles { get { return sourceHandles.AsReadOnly(); } }
        public IList<string> GeometryQualities { get { return geometryQualities.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return DimensionGeometryBindingMaps.Map(
                "anchor_candidate_id", Id,
                "target_kind", TargetKind,
                "vertex_id", string.IsNullOrEmpty(VertexId) ? null : (object)VertexId,
                "edge_ids", new List<string>(edgeIds),
                "snapped_point", new[] { X, Y },
                "distance", Distance,
                "tolerance", Tolerance,
                "region_ids", new List<string>(regionIds),
                "profile_ids", new List<string>(profileIds),
                "interface_feature_ids", new List<string>(interfaceFeatureIds),
                "physical_object_cluster_ids", new List<string>(objectClusterIds),
                "source_handles", new List<string>(sourceHandles),
                "geometry_qualities", new List<string>(geometryQualities),
                "evidence_grade", TargetKind == "topology_vertex"
                    ? "derived_topology_vertex_within_scaled_tolerance"
                    : "derived_topology_edge_projection_within_scaled_tolerance");
        }
    }

    public sealed class DimensionEndpointBindingRecord
    {
        readonly List<DimensionGeometryAnchorCandidateRecord> candidates;

        internal DimensionEndpointBindingRecord(
            string role,
            double x,
            double y,
            double z,
            string status,
            bool truncated,
            IEnumerable<DimensionGeometryAnchorCandidateRecord> values)
        {
            Role = role ?? "";
            SourceX = x;
            SourceY = y;
            SourceZ = z;
            Status = status ?? "unbound";
            CandidatesTruncated = truncated;
            candidates = values == null
                ? new List<DimensionGeometryAnchorCandidateRecord>()
                : values.ToList();
        }

        public string Role { get; private set; }
        public double SourceX { get; private set; }
        public double SourceY { get; private set; }
        public double SourceZ { get; private set; }
        public string Status { get; private set; }
        public bool CandidatesTruncated { get; private set; }
        public IList<DimensionGeometryAnchorCandidateRecord> Candidates
        {
            get { return candidates.AsReadOnly(); }
        }
        public bool IsUnique { get { return candidates.Count == 1 && !CandidatesTruncated; } }

        public Dictionary<string, object> ToMap()
        {
            return DimensionGeometryBindingMaps.Map(
                "endpoint_role", Role,
                "definition_point_world", new[] { SourceX, SourceY, SourceZ },
                "status", Status,
                "candidate_count", candidates.Count,
                "candidates_truncated", CandidatesTruncated,
                "anchor_candidates", candidates.Select(value => value.ToMap()).ToList());
        }
    }

    public sealed class DimensionGeometryComparisonRecord
    {
        readonly List<double> displayNumericTokens;

        internal DimensionGeometryComparisonRecord(
            string displayStatus,
            string displayOperator,
            string displayGeometryBasis,
            IEnumerable<double> numericTokens,
            double? effectiveDisplayValue,
            string effectiveDisplaySource,
            double? worldSpanMin,
            double? worldSpanMax,
            double? sourceSpanMin,
            double? sourceSpanMax,
            string determinacy,
            int combinationCount,
            bool combinationsTruncated,
            double? entityResidualMin,
            double? entityResidualMax,
            double? displayResidualMin,
            double? displayResidualMax,
            double? entityTolerance,
            double? displayTolerance,
            string entityStatus,
            string displayComparisonStatus,
            string primaryStatus)
        {
            DisplayOverrideStatus = displayStatus ?? "";
            DisplayNumericComparisonOperator = displayOperator ?? "not_comparable";
            DisplayGeometryComparisonBasis = displayGeometryBasis ?? "source_dimension_unit_geometry";
            displayNumericTokens = numericTokens == null
                ? new List<double>()
                : numericTokens.ToList();
            EffectiveDisplayedValue = effectiveDisplayValue;
            EffectiveDisplayedValueSource = effectiveDisplaySource ?? "";
            WorldGeometrySpanMinimum = worldSpanMin;
            WorldGeometrySpanMaximum = worldSpanMax;
            SourceUnitGeometrySpanMinimum = sourceSpanMin;
            SourceUnitGeometrySpanMaximum = sourceSpanMax;
            MeasurementDeterminacy = determinacy ?? "not_available";
            CandidateCombinationCount = combinationCount;
            CandidateCombinationsTruncated = combinationsTruncated;
            GeometryMinusEntityMeasurementMinimum = entityResidualMin;
            GeometryMinusEntityMeasurementMaximum = entityResidualMax;
            GeometryMinusDisplayedValueMinimum = displayResidualMin;
            GeometryMinusDisplayedValueMaximum = displayResidualMax;
            EntityComparisonTolerance = entityTolerance;
            DisplayComparisonTolerance = displayTolerance;
            EntityMeasurementComparisonStatus = entityStatus ?? "not_comparable";
            DisplayedValueComparisonStatus = displayComparisonStatus ?? "not_comparable";
            PrimaryComparisonStatus = primaryStatus ?? "not_comparable";
        }

        public string DisplayOverrideStatus { get; private set; }
        public string DisplayNumericComparisonOperator { get; private set; }
        public string DisplayGeometryComparisonBasis { get; private set; }
        public IList<double> DisplayNumericTokens { get { return displayNumericTokens.AsReadOnly(); } }
        public double? EffectiveDisplayedValue { get; private set; }
        public string EffectiveDisplayedValueSource { get; private set; }
        public double? WorldGeometrySpanMinimum { get; private set; }
        public double? WorldGeometrySpanMaximum { get; private set; }
        public double? SourceUnitGeometrySpanMinimum { get; private set; }
        public double? SourceUnitGeometrySpanMaximum { get; private set; }
        public string MeasurementDeterminacy { get; private set; }
        public int CandidateCombinationCount { get; private set; }
        public bool CandidateCombinationsTruncated { get; private set; }
        public double? GeometryMinusEntityMeasurementMinimum { get; private set; }
        public double? GeometryMinusEntityMeasurementMaximum { get; private set; }
        public double? GeometryMinusDisplayedValueMinimum { get; private set; }
        public double? GeometryMinusDisplayedValueMaximum { get; private set; }
        public double? EntityComparisonTolerance { get; private set; }
        public double? DisplayComparisonTolerance { get; private set; }
        public string EntityMeasurementComparisonStatus { get; private set; }
        public string DisplayedValueComparisonStatus { get; private set; }
        public string PrimaryComparisonStatus { get; private set; }
        public double? GeometryToDisplayedValueScaleMinimum
        {
            get
            {
                return EffectiveDisplayedValue.HasValue
                    && Math.Abs(EffectiveDisplayedValue.Value) > 0.000000000001
                    && SourceUnitGeometrySpanMinimum.HasValue
                        ? (double?)(SourceUnitGeometrySpanMinimum.Value
                            / Math.Abs(EffectiveDisplayedValue.Value))
                        : null;
            }
        }
        public double? GeometryToDisplayedValueScaleMaximum
        {
            get
            {
                return EffectiveDisplayedValue.HasValue
                    && Math.Abs(EffectiveDisplayedValue.Value) > 0.000000000001
                    && SourceUnitGeometrySpanMaximum.HasValue
                        ? (double?)(SourceUnitGeometrySpanMaximum.Value
                            / Math.Abs(EffectiveDisplayedValue.Value))
                        : null;
            }
        }

        public Dictionary<string, object> ToMap()
        {
            return DimensionGeometryBindingMaps.Map(
                "display_override_status", DisplayOverrideStatus,
                "display_numeric_comparison_operator", DisplayNumericComparisonOperator,
                "display_geometry_comparison_basis", DisplayGeometryComparisonBasis,
                "display_numeric_tokens", new List<double>(displayNumericTokens),
                "effective_displayed_value", DimensionGeometryBindingMaps.Nullable(EffectiveDisplayedValue),
                "effective_displayed_value_source", EffectiveDisplayedValueSource,
                "world_geometry_span_range", NullableRange(
                    WorldGeometrySpanMinimum,
                    WorldGeometrySpanMaximum),
                "source_dimension_unit_geometry_span_range", NullableRange(
                    SourceUnitGeometrySpanMinimum,
                    SourceUnitGeometrySpanMaximum),
                "geometry_to_displayed_value_scale_range", NullableRange(
                    GeometryToDisplayedValueScaleMinimum,
                    GeometryToDisplayedValueScaleMaximum),
                "measurement_determinacy", MeasurementDeterminacy,
                "candidate_combination_count", CandidateCombinationCount,
                "candidate_combinations_truncated", CandidateCombinationsTruncated,
                "geometry_minus_entity_measurement_range", NullableRange(
                    GeometryMinusEntityMeasurementMinimum,
                    GeometryMinusEntityMeasurementMaximum),
                "geometry_minus_displayed_value_range", NullableRange(
                    GeometryMinusDisplayedValueMinimum,
                    GeometryMinusDisplayedValueMaximum),
                "entity_comparison_tolerance", DimensionGeometryBindingMaps.Nullable(EntityComparisonTolerance),
                "display_comparison_tolerance", DimensionGeometryBindingMaps.Nullable(DisplayComparisonTolerance),
                "entity_measurement_comparison_status", EntityMeasurementComparisonStatus,
                "displayed_value_comparison_status", DisplayedValueComparisonStatus,
                "primary_comparison_status", PrimaryComparisonStatus,
                "review_semantics", "numeric_residual_candidate_not_drawing_defect_or_acceptance_proof");
        }

        static object NullableRange(double? minimum, double? maximum)
        {
            return minimum.HasValue && maximum.HasValue
                ? (object)new[] { minimum.Value, maximum.Value }
                : null;
        }
    }

    public sealed class DimensionGeometryBindingRecord
    {
        readonly List<string> chainIds;
        readonly List<string> regionIds;
        readonly List<string> profileIds;
        readonly List<string> interfaceFeatureIds;
        readonly List<string> objectClusterIds;
        readonly List<string> instancePath;

        internal DimensionGeometryBindingRecord(
            string id,
            DimensionEdgeRecord edge,
            DimensionGeometryPlacementObservation placement,
            string status,
            string linkKind,
            DimensionEndpointBindingRecord first,
            DimensionEndpointBindingRecord second,
            DimensionGeometryComparisonRecord comparison,
            IEnumerable<string> regions,
            IEnumerable<string> profiles,
            IEnumerable<string> features,
            IEnumerable<string> objects)
        {
            Id = id ?? "";
            DimensionHandle = edge == null ? "" : edge.Handle;
            DimensionEdgeId = edge == null ? "" : edge.Id;
            RuntimeClass = edge == null ? "" : edge.RuntimeClass;
            DimensionType = edge == null ? "" : edge.DimensionType;
            Layer = edge == null ? "" : edge.Layer;
            OwnerScope = edge == null ? "" : edge.OwnerScope;
            OwnerBlockName = edge == null ? "" : edge.OwnerBlockName;
            HasEntityMeasurement = edge != null && edge.HasMeasurement;
            EntityMeasurement = edge == null ? 0 : edge.Measurement;
            SourceDefinitionSpan = edge == null ? 0 : edge.GeometricSpan;
            EntityMeasurementMinusDefinitionSpan = edge != null && edge.HasMeasurement
                ? (double?)edge.MeasurementResidual
                : null;
            DimensionText = edge == null ? "" : edge.DimensionText;
            DimensionStyle = edge == null ? "" : edge.DimensionStyle;
            AssociationHandle = edge == null ? "" : edge.AssociationHandle;
            HasAuthoredLinearMeasurementFactor = edge != null
                && edge.HasLinearMeasurementFactor;
            AuthoredLinearMeasurementFactor = edge == null
                ? 0
                : edge.LinearMeasurementFactor;
            IsReferenceDimensionCandidate = edge != null && edge.IsReferenceDimensionCandidate;
            chainIds = edge == null
                ? new List<string>()
                : DimensionGeometryBindingMaps.SortedUnique(edge.ChainIds);
            OccurrenceId = placement == null ? "" : placement.OccurrenceId;
            SourceDefinitionHandle = placement == null ? "" : placement.SourceDefinitionHandle;
            SourceDefinitionName = placement == null ? "" : placement.SourceDefinitionName;
            SourceOccurrenceStatus = placement == null ? "" : placement.SourceOccurrenceStatus;
            Visible = placement != null && placement.Visible;
            IsMirrored = placement != null && placement.IsMirrored;
            AxisX = placement == null ? 0 : placement.AxisX;
            AxisY = placement == null ? 0 : placement.AxisY;
            AxisScale = placement == null ? 0 : placement.AxisScale;
            WorldDefinitionSpan = placement == null ? (double?)null : placement.WorldDefinitionSpan;
            instancePath = placement == null
                ? new List<string>()
                : new List<string>(placement.InstancePath);
            Status = status ?? "unbound";
            LinkKind = linkKind ?? "no_structural_geometry_link";
            FirstEndpoint = first;
            SecondEndpoint = second;
            Comparison = comparison;
            regionIds = DimensionGeometryBindingMaps.SortedUnique(regions);
            profileIds = DimensionGeometryBindingMaps.SortedUnique(profiles);
            interfaceFeatureIds = DimensionGeometryBindingMaps.SortedUnique(features);
            objectClusterIds = DimensionGeometryBindingMaps.SortedUnique(objects);
        }

        public string Id { get; private set; }
        public string DimensionHandle { get; private set; }
        public string DimensionEdgeId { get; private set; }
        public string RuntimeClass { get; private set; }
        public string DimensionType { get; private set; }
        public string Layer { get; private set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public bool HasEntityMeasurement { get; private set; }
        public double EntityMeasurement { get; private set; }
        public double SourceDefinitionSpan { get; private set; }
        public double? EntityMeasurementMinusDefinitionSpan { get; private set; }
        public string DimensionText { get; private set; }
        public string DimensionStyle { get; private set; }
        public string AssociationHandle { get; private set; }
        public bool HasAuthoredLinearMeasurementFactor { get; private set; }
        public double AuthoredLinearMeasurementFactor { get; private set; }
        public bool IsReferenceDimensionCandidate { get; private set; }
        public IList<string> ChainIds { get { return chainIds.AsReadOnly(); } }
        public string OccurrenceId { get; private set; }
        public string SourceDefinitionHandle { get; private set; }
        public string SourceDefinitionName { get; private set; }
        public string SourceOccurrenceStatus { get; private set; }
        public IList<string> InstancePath { get { return instancePath.AsReadOnly(); } }
        public bool Visible { get; private set; }
        public bool IsMirrored { get; private set; }
        public double AxisX { get; private set; }
        public double AxisY { get; private set; }
        public double AxisScale { get; private set; }
        public double? WorldDefinitionSpan { get; private set; }
        public string Status { get; private set; }
        public string LinkKind { get; private set; }
        public DimensionEndpointBindingRecord FirstEndpoint { get; private set; }
        public DimensionEndpointBindingRecord SecondEndpoint { get; private set; }
        public DimensionGeometryComparisonRecord Comparison { get; private set; }
        public IList<string> RegionIds { get { return regionIds.AsReadOnly(); } }
        public IList<string> ProfileIds { get { return profileIds.AsReadOnly(); } }
        public IList<string> InterfaceFeatureIds { get { return interfaceFeatureIds.AsReadOnly(); } }
        public IList<string> PhysicalObjectClusterIds { get { return objectClusterIds.AsReadOnly(); } }
        public string DisplayScaleHypothesisId { get; private set; }
        public double? InferredGeometryToDisplayScale { get; private set; }
        public double? ScaleNormalizedGeometryMinusDisplay { get; private set; }
        public string ScaleNormalizedComparisonStatus { get; private set; }

        internal void AttachDisplayScaleHypothesis(
            string hypothesisId,
            double ratio,
            double residual,
            string status)
        {
            DisplayScaleHypothesisId = hypothesisId ?? "";
            InferredGeometryToDisplayScale = ratio;
            ScaleNormalizedGeometryMinusDisplay = residual;
            ScaleNormalizedComparisonStatus = status ?? "not_comparable";
        }

        public Dictionary<string, object> ToMap()
        {
            return DimensionGeometryBindingMaps.Map(
                "binding_id", Id,
                "dimension_handle", DimensionHandle,
                "dimension_edge_id", DimensionEdgeId,
                "runtime_class", RuntimeClass,
                "dimension_type", DimensionType,
                "layer", Layer,
                "owner_scope", OwnerScope,
                "owner_block_name", OwnerBlockName,
                "occurrence_id", string.IsNullOrEmpty(OccurrenceId) ? null : (object)OccurrenceId,
                "source_definition_handle", SourceDefinitionHandle,
                "source_definition_name", SourceDefinitionName,
                "instance_path", new List<string>(instancePath),
                "source_occurrence_status", SourceOccurrenceStatus,
                "visible", Visible,
                "mirrored", IsMirrored,
                "world_axis", WorldDefinitionSpan.HasValue ? (object)new[] { AxisX, AxisY } : null,
                "axis_scale_to_world", WorldDefinitionSpan.HasValue ? (object)AxisScale : null,
                "source_definition_span", SourceDefinitionSpan,
                "world_definition_span", DimensionGeometryBindingMaps.Nullable(WorldDefinitionSpan),
                "entity_measurement", HasEntityMeasurement ? (object)EntityMeasurement : null,
                "entity_measurement_minus_source_definition_span",
                    DimensionGeometryBindingMaps.Nullable(EntityMeasurementMinusDefinitionSpan),
                "dimension_text", DimensionText,
                "dimension_style", DimensionStyle,
                "association_handle", AssociationHandle,
                "authored_linear_measurement_factor",
                    HasAuthoredLinearMeasurementFactor
                        ? (object)AuthoredLinearMeasurementFactor
                        : null,
                "authored_association_evidence", string.IsNullOrEmpty(AssociationHandle)
                    ? "not_present"
                    : "acad_dimassoc_object_present_payload_not_interpreted",
                "reference_dimension_candidate", IsReferenceDimensionCandidate,
                "chain_ids", new List<string>(chainIds),
                "status", Status,
                "link_kind", LinkKind,
                "region_ids", new List<string>(regionIds),
                "profile_ids", new List<string>(profileIds),
                "interface_feature_ids", new List<string>(interfaceFeatureIds),
                "physical_object_cluster_ids", new List<string>(objectClusterIds),
                "endpoints", DimensionGeometryBindingMaps.Map(
                    "xline1", FirstEndpoint == null ? null : (object)FirstEndpoint.ToMap(),
                    "xline2", SecondEndpoint == null ? null : (object)SecondEndpoint.ToMap()),
                "comparison", Comparison == null ? null : (object)Comparison.ToMap(),
                "display_scale_hypothesis", string.IsNullOrEmpty(DisplayScaleHypothesisId)
                    ? null
                    : (object)DimensionGeometryBindingMaps.Map(
                        "hypothesis_id", DisplayScaleHypothesisId,
                        "geometry_to_display_scale",
                            DimensionGeometryBindingMaps.Nullable(InferredGeometryToDisplayScale),
                        "scale_normalized_geometry_minus_display",
                            DimensionGeometryBindingMaps.Nullable(ScaleNormalizedGeometryMinusDisplay),
                        "scale_normalized_comparison_status", ScaleNormalizedComparisonStatus),
                "semantic_boundary", "dimension_attachment_and_numeric_residual_evidence_not_associativity_design_intent_or_defect_proof");
        }
    }

    public sealed class DimensionDisplayScaleHypothesisRecord
    {
        readonly List<string> bindingIds;
        readonly List<string> dimensionHandles;
        readonly List<double> observedRatios;

        internal DimensionDisplayScaleHypothesisRecord(
            string id,
            string regionId,
            string dimensionStyle,
            double ratio,
            double maximumRelativeSpread,
            IEnumerable<DimensionGeometryBindingRecord> bindings,
            IEnumerable<double> ratios)
        {
            Id = id ?? "";
            RegionId = regionId ?? "";
            DimensionStyle = dimensionStyle ?? "";
            GeometryToDisplayScale = ratio;
            MaximumRelativeSpread = maximumRelativeSpread;
            List<DimensionGeometryBindingRecord> values = bindings == null
                ? new List<DimensionGeometryBindingRecord>()
                : bindings.ToList();
            bindingIds = DimensionGeometryBindingMaps.SortedUnique(values.Select(value => value.Id));
            dimensionHandles = DimensionGeometryBindingMaps.SortedUnique(
                values.Select(value => value.DimensionHandle));
            observedRatios = ratios == null
                ? new List<double>()
                : ratios.OrderBy(value => value).ToList();
        }

        public string Id { get; private set; }
        public string RegionId { get; private set; }
        public string DimensionStyle { get; private set; }
        public double GeometryToDisplayScale { get; private set; }
        public double MaximumRelativeSpread { get; private set; }
        public int SupportCount { get { return bindingIds.Count; } }
        public IList<string> BindingIds { get { return bindingIds.AsReadOnly(); } }
        public IList<string> DimensionHandles { get { return dimensionHandles.AsReadOnly(); } }
        public IList<double> ObservedRatios { get { return observedRatios.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return DimensionGeometryBindingMaps.Map(
                "display_scale_hypothesis_id", Id,
                "region_id", RegionId,
                "dimension_style", DimensionStyle,
                "geometry_to_display_scale", GeometryToDisplayScale,
                "support_count", bindingIds.Count,
                "maximum_relative_spread", MaximumRelativeSpread,
                "binding_ids", new List<string>(bindingIds),
                "dimension_handles", new List<string>(dimensionHandles),
                "observed_ratios", new List<double>(observedRatios),
                "status", "repeated_numeric_override_ratio_candidate",
                "semantic_boundary", "repeated_ratio_not_authored_view_scale_unit_conversion_or_correctness_proof");
        }
    }

    public sealed class DimensionGeometryObjectSummaryRecord
    {
        readonly List<string> bindingIds;
        readonly List<string> dimensionHandles;
        readonly List<string> regionIds;
        readonly Dictionary<string, int> comparisonStatusCounts;

        internal DimensionGeometryObjectSummaryRecord(
            string objectClusterId,
            IEnumerable<DimensionGeometryBindingRecord> bindings)
        {
            PhysicalObjectClusterId = objectClusterId ?? "";
            List<DimensionGeometryBindingRecord> values = bindings == null
                ? new List<DimensionGeometryBindingRecord>()
                : bindings.ToList();
            bindingIds = DimensionGeometryBindingMaps.SortedUnique(values.Select(value => value.Id));
            dimensionHandles = DimensionGeometryBindingMaps.SortedUnique(
                values.Select(value => value.DimensionHandle));
            regionIds = DimensionGeometryBindingMaps.SortedUnique(
                values.SelectMany(value => value.RegionIds));
            comparisonStatusCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (DimensionGeometryBindingRecord binding in values)
            {
                string status = binding.Comparison == null
                    ? "not_comparable"
                    : binding.Comparison.PrimaryComparisonStatus;
                int count;
                comparisonStatusCounts.TryGetValue(status, out count);
                comparisonStatusCounts[status] = count + 1;
            }
        }

        public string PhysicalObjectClusterId { get; private set; }
        public IList<string> BindingIds { get { return bindingIds.AsReadOnly(); } }
        public IList<string> DimensionHandles { get { return dimensionHandles.AsReadOnly(); } }
        public IList<string> RegionIds { get { return regionIds.AsReadOnly(); } }
        public IDictionary<string, int> ComparisonStatusCounts
        {
            get { return new Dictionary<string, int>(comparisonStatusCounts, StringComparer.Ordinal); }
        }

        public Dictionary<string, object> ToMap()
        {
            return DimensionGeometryBindingMaps.Map(
                "physical_object_cluster_id", PhysicalObjectClusterId,
                "binding_ids", new List<string>(bindingIds),
                "dimension_handles", new List<string>(dimensionHandles),
                "region_ids", new List<string>(regionIds),
                "comparison_status_counts", new Dictionary<string, int>(comparisonStatusCounts),
                "cross_view_status", "identity_index_only_no_dimension_or_geometry_fusion");
        }
    }

    public sealed class DimensionGeometryBindingDiagnosticRecord
    {
        internal DimensionGeometryBindingDiagnosticRecord(
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
            return DimensionGeometryBindingMaps.Map(
                "code", Code,
                "status", Status,
                "source_id", SourceId,
                "message", Message);
        }
    }

    public sealed class DimensionGeometryBindingDocument
    {
        readonly List<DimensionGeometryBindingRecord> bindings;
        readonly List<DimensionDisplayScaleHypothesisRecord> scaleHypotheses;
        readonly List<DimensionGeometryObjectSummaryRecord> objectSummaries;
        readonly List<DimensionGeometryBindingDiagnosticRecord> diagnostics;
        readonly List<string> unplacedSourceHandles;

        internal DimensionGeometryBindingDocument(
            string drawingId,
            string regionStatus,
            string topologyStatus,
            string manufacturingStatus,
            string interfaceStatus,
            int inputDimensionCount,
            int inputPlacementCount,
            int processedPlacementCount,
            IEnumerable<string> unplacedHandles,
            IEnumerable<DimensionGeometryBindingRecord> bindingValues,
            IEnumerable<DimensionDisplayScaleHypothesisRecord> hypothesisValues,
            IEnumerable<DimensionGeometryObjectSummaryRecord> summaries,
            IEnumerable<DimensionGeometryBindingDiagnosticRecord> diagnosticValues)
        {
            DrawingId = drawingId ?? "";
            SourceRegionStatus = regionStatus ?? "";
            SourceTopologyStatus = topologyStatus ?? "";
            SourceManufacturingStatus = manufacturingStatus ?? "";
            SourceInterfaceStatus = interfaceStatus ?? "";
            InputDimensionCount = inputDimensionCount;
            InputPlacementCount = inputPlacementCount;
            ProcessedPlacementCount = processedPlacementCount;
            unplacedSourceHandles = DimensionGeometryBindingMaps.SortedUnique(unplacedHandles);
            bindings = bindingValues == null
                ? new List<DimensionGeometryBindingRecord>()
                : bindingValues.OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
            scaleHypotheses = hypothesisValues == null
                ? new List<DimensionDisplayScaleHypothesisRecord>()
                : hypothesisValues.OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
            objectSummaries = summaries == null
                ? new List<DimensionGeometryObjectSummaryRecord>()
                : summaries.OrderBy(value => value.PhysicalObjectClusterId, StringComparer.Ordinal).ToList();
            diagnostics = diagnosticValues == null
                ? new List<DimensionGeometryBindingDiagnosticRecord>()
                : diagnosticValues.ToList();
            bool unsupported = diagnostics.Any(value => value.Status == "unsupported")
                || SourceRegionStatus == "unsupported_partial"
                || SourceTopologyStatus == "unsupported_partial"
                || SourceManufacturingStatus == "unsupported_partial"
                || SourceInterfaceStatus == "unsupported_partial";
            bool ambiguous = diagnostics.Any(value => value.Status == "ambiguous")
                || SourceRegionStatus == "ambiguous"
                || SourceTopologyStatus == "ambiguous"
                || SourceManufacturingStatus == "ambiguous"
                || SourceInterfaceStatus == "ambiguous";
            Status = unsupported ? "unsupported_partial" : ambiguous ? "ambiguous" : "computed";
        }

        public string DrawingId { get; private set; }
        public string Status { get; private set; }
        public string SourceRegionStatus { get; private set; }
        public string SourceTopologyStatus { get; private set; }
        public string SourceManufacturingStatus { get; private set; }
        public string SourceInterfaceStatus { get; private set; }
        public int InputDimensionCount { get; private set; }
        public int InputPlacementCount { get; private set; }
        public int ProcessedPlacementCount { get; private set; }
        public int TruncatedPlacementCount
        {
            get { return Math.Max(0, InputPlacementCount - ProcessedPlacementCount); }
        }
        public IList<string> UnplacedSourceDimensionHandles
        {
            get { return unplacedSourceHandles.AsReadOnly(); }
        }
        public IList<DimensionGeometryBindingRecord> Bindings { get { return bindings.AsReadOnly(); } }
        public IList<DimensionDisplayScaleHypothesisRecord> DisplayScaleHypotheses
        {
            get { return scaleHypotheses.AsReadOnly(); }
        }
        public IList<DimensionGeometryObjectSummaryRecord> ObjectSummaries
        {
            get { return objectSummaries.AsReadOnly(); }
        }
        public IList<DimensionGeometryBindingDiagnosticRecord> Diagnostics
        {
            get { return diagnostics.AsReadOnly(); }
        }
        public int UniqueBindingCount { get { return bindings.Count(value => value.Status == "bound_unique"); } }
        public int AmbiguousBindingCount { get { return bindings.Count(value => value.Status == "bound_ambiguous"); } }
        public int PartialBindingCount { get { return bindings.Count(value => value.Status == "partially_bound"); } }
        public int UnboundPlacementCount { get { return bindings.Count(value => value.Status == "unbound"); } }
        public int ComparableBindingCount
        {
            get
            {
                return bindings.Count(value => value.Comparison != null
                    && value.Comparison.SourceUnitGeometrySpanMinimum.HasValue);
            }
        }
        public int NumericOverrideCount
        {
            get
            {
                return bindings.Count(value => value.Comparison != null
                    && (value.Comparison.DisplayOverrideStatus == "numeric_text_override"
                        || value.Comparison.DisplayOverrideStatus == "numeric_text_override_with_additional_values"
                        || value.Comparison.DisplayOverrideStatus == "diameter_numeric_text_override"
                        || value.Comparison.DisplayOverrideStatus == "lower_bound_numeric_text_override"
                        || value.Comparison.DisplayOverrideStatus == "upper_bound_numeric_text_override"));
            }
        }
        public int OutsideToleranceCandidateCount
        {
            get
            {
                return bindings.Count(value => IsOutsideStatus(
                    value.Comparison == null
                        ? ""
                        : value.Comparison.PrimaryComparisonStatus));
            }
        }
        public int ScaleExplainedOutsideCandidateCount
        {
            get
            {
                return bindings.Count(value => value.Comparison != null
                    && IsOutsideStatus(value.Comparison.PrimaryComparisonStatus)
                    && value.ScaleNormalizedComparisonStatus
                        == "within_inferred_scale_numeric_tolerance_candidate");
            }
        }
        public int UnexplainedOutsideCandidateCount
        {
            get { return Math.Max(0, OutsideToleranceCandidateCount - ScaleExplainedOutsideCandidateCount); }
        }

        public Dictionary<string, object> ToMap()
        {
            return DimensionGeometryBindingMaps.Map(
                "schema_version", "1",
                "analysis_type", "dimension_geometry_binding",
                "analyzer_version", "1",
                "drawing_id", DrawingId,
                "status", Status,
                "source_region_status", SourceRegionStatus,
                "source_topology_status", SourceTopologyStatus,
                "source_manufacturing_status", SourceManufacturingStatus,
                "source_interface_status", SourceInterfaceStatus,
                "input_dimension_count", InputDimensionCount,
                "input_placement_count", InputPlacementCount,
                "processed_placement_count", ProcessedPlacementCount,
                "truncated_placement_count", TruncatedPlacementCount,
                "unplaced_source_dimension_count", unplacedSourceHandles.Count,
                "unplaced_source_dimension_handles", new List<string>(unplacedSourceHandles),
                "binding_record_count", bindings.Count,
                "unique_binding_count", UniqueBindingCount,
                "ambiguous_binding_count", AmbiguousBindingCount,
                "partial_binding_count", PartialBindingCount,
                "unbound_placement_count", UnboundPlacementCount,
                "comparable_binding_count", ComparableBindingCount,
                "numeric_text_override_count", NumericOverrideCount,
                "outside_tolerance_candidate_count", OutsideToleranceCandidateCount,
                "display_scale_hypothesis_count", scaleHypotheses.Count,
                "scale_explained_outside_candidate_count",
                    ScaleExplainedOutsideCandidateCount,
                "unexplained_outside_candidate_count", UnexplainedOutsideCandidateCount,
                "object_summary_count", objectSummaries.Count,
                "bindings", bindings.Select(value => value.ToMap()).ToList(),
                "display_scale_hypotheses",
                    scaleHypotheses.Select(value => value.ToMap()).ToList(),
                "object_summaries", objectSummaries.Select(value => value.ToMap()).ToList(),
                "diagnostics", diagnostics.Select(value => value.ToMap()).ToList(),
                "semantic_contract", DimensionGeometryBindingMaps.Map(
                    "coordinate_scope", "dimension_definition_points_expanded_by_11_instance_transform_before_binding",
                    "attachment", "proximity_to_12_topology_not_native_dimension_associativity_proof",
                    "geometry", "12_sampled_projected_geometry_with_source_quality_retained",
                    "profile", "16_profile_and_17_interface_links_are_candidates_not_part_feature_identity",
                    "numeric_residual", "configured_screening_candidate_not_acceptance_or_defect_proof",
                    "display_scale_hypothesis", "repeated_override_ratio_not_authored_scale_or_correctness_proof",
                    "reference_dimension", "parenthesized_candidate_retained_as_non_driving_review_context",
                    "units", "source_dimension_units_and_world_drawing_units_reported_without_guessing_unit_name",
                    "cross_view", "15_identity_used_for_index_summary_only_no_geometry_fusion"),
                "mutation_status", "read_only_no_entities_modified");
        }

        public string ToMarkdown()
        {
            var builder = new StringBuilder();
            builder.AppendLine("# 尺寸—几何绑定与量值核对");
            builder.AppendLine();
            builder.AppendLine("- 图纸：`" + DrawingId + "`");
            builder.AppendLine("- 状态：`" + Status + "`（源拓扑：`" + SourceTopologyStatus + "`）");
            builder.AppendLine("- 尺寸定义 / 实例放置 / 未放置定义："
                + InputDimensionCount.ToString(CultureInfo.InvariantCulture)
                + " / " + InputPlacementCount.ToString(CultureInfo.InvariantCulture)
                + " / " + unplacedSourceHandles.Count.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine("- 唯一绑定 / 多解 / 单端绑定 / 双端未绑定："
                + UniqueBindingCount.ToString(CultureInfo.InvariantCulture)
                + " / " + AmbiguousBindingCount.ToString(CultureInfo.InvariantCulture)
                + " / " + PartialBindingCount.ToString(CultureInfo.InvariantCulture)
                + " / " + UnboundPlacementCount.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine("- 可量值核对 / 数字覆盖 / 超阈值候选："
                + ComparableBindingCount.ToString(CultureInfo.InvariantCulture)
                + " / " + NumericOverrideCount.ToString(CultureInfo.InvariantCulture)
                + " / " + OutsideToleranceCandidateCount.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine("- 重复比例假设 / 比例可解释候选 / 尚未解释候选："
                + scaleHypotheses.Count.ToString(CultureInfo.InvariantCulture)
                + " / " + ScaleExplainedOutsideCandidateCount.ToString(CultureInfo.InvariantCulture)
                + " / " + UnexplainedOutsideCandidateCount.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine();
            builder.AppendLine("尺寸定义点先按块实例变换进入世界坐标，再与工程视图区内结构拓扑绑定；未放置块定义、多解和未绑定均原样保留。数值残差只是复核候选，不自动证明尺寸错误、几何错误、公差不合格或应修改图纸。");
            return builder.ToString().TrimEnd();
        }

        static bool IsOutsideStatus(string status)
        {
            return status == "outside_configured_numeric_tolerance_candidate"
                || status == "outside_displayed_lower_bound_candidate"
                || status == "outside_displayed_upper_bound_candidate";
        }
    }

    public static class DimensionGeometryBindingAnalyzer
    {
        sealed class DisplayInterpretation
        {
            public string Status;
            public string Operator;
            public bool AppliesAuthoredLinearFactor;
            public readonly List<double> Tokens = new List<double>();
            public double? EffectiveValue;
            public string EffectiveSource;
        }

        sealed class RawAnchor
        {
            public string Kind;
            public PlanarVertexRecord Vertex;
            public PlanarEdgeRecord Edge;
            public double X;
            public double Y;
            public double Distance;
            public double Tolerance;
        }

        sealed class ScaleCandidate
        {
            public DimensionGeometryBindingRecord Binding;
            public string RegionId;
            public string DimensionStyle;
            public double Ratio;
            public double GeometrySpan;
            public double DisplayValue;
        }

        sealed class ScaleCluster
        {
            public string RegionId;
            public string DimensionStyle;
            public readonly List<ScaleCandidate> Candidates = new List<ScaleCandidate>();
            public double MeanRatio
            {
                get { return Candidates.Count == 0 ? 0 : Candidates.Average(value => value.Ratio); }
            }
        }

        sealed class SegmentReference
        {
            public PlanarEdgeRecord Edge;
            public PlanarVertexRecord Start;
            public PlanarVertexRecord End;
        }

        sealed class SpatialIndex
        {
            readonly double cellSize;
            readonly int maxCellsPerEdge;
            readonly Dictionary<string, List<PlanarVertexRecord>> vertices;
            readonly Dictionary<string, List<SegmentReference>> segments;
            readonly List<SegmentReference> oversized;

            public SpatialIndex(double size, int maximumCellsPerEdge)
            {
                cellSize = Math.Max(size, 0.000000001);
                maxCellsPerEdge = Math.Max(1, maximumCellsPerEdge);
                vertices = new Dictionary<string, List<PlanarVertexRecord>>(StringComparer.Ordinal);
                segments = new Dictionary<string, List<SegmentReference>>(StringComparer.Ordinal);
                oversized = new List<SegmentReference>();
            }

            public void AddVertex(PlanarVertexRecord vertex)
            {
                Add(vertices, Key(Cell(vertex.X), Cell(vertex.Y)), vertex);
            }

            public void AddSegment(SegmentReference segment)
            {
                long minX = Cell(Math.Min(segment.Start.X, segment.End.X));
                long maxX = Cell(Math.Max(segment.Start.X, segment.End.X));
                long minY = Cell(Math.Min(segment.Start.Y, segment.End.Y));
                long maxY = Cell(Math.Max(segment.Start.Y, segment.End.Y));
                long width = maxX - minX + 1;
                long height = maxY - minY + 1;
                if (width <= 0 || height <= 0 || width > maxCellsPerEdge
                    || height > maxCellsPerEdge || width * height > maxCellsPerEdge)
                {
                    oversized.Add(segment);
                    return;
                }
                for (long x = minX; x <= maxX; x++)
                {
                    for (long y = minY; y <= maxY; y++)
                    {
                        Add(segments, Key(x, y), segment);
                    }
                }
            }

            public IList<PlanarVertexRecord> QueryVertices(double x, double y, double tolerance)
            {
                var found = new Dictionary<string, PlanarVertexRecord>(StringComparer.Ordinal);
                VisitCells(x, y, tolerance, delegate(string key)
                {
                    List<PlanarVertexRecord> values;
                    if (!vertices.TryGetValue(key, out values)) { return; }
                    foreach (PlanarVertexRecord value in values) { found[value.Id] = value; }
                });
                return found.Values.ToList();
            }

            public IList<SegmentReference> QuerySegments(double x, double y, double tolerance)
            {
                var found = new Dictionary<string, SegmentReference>(StringComparer.Ordinal);
                VisitCells(x, y, tolerance, delegate(string key)
                {
                    List<SegmentReference> values;
                    if (!segments.TryGetValue(key, out values)) { return; }
                    foreach (SegmentReference value in values) { found[value.Edge.Id] = value; }
                });
                foreach (SegmentReference value in oversized) { found[value.Edge.Id] = value; }
                return found.Values.ToList();
            }

            void VisitCells(double x, double y, double tolerance, Action<string> action)
            {
                long minX = Cell(x - tolerance);
                long maxX = Cell(x + tolerance);
                long minY = Cell(y - tolerance);
                long maxY = Cell(y + tolerance);
                for (long cx = minX; cx <= maxX; cx++)
                {
                    for (long cy = minY; cy <= maxY; cy++) { action(Key(cx, cy)); }
                }
            }

            long Cell(double value) { return (long)Math.Floor(value / cellSize); }
            static string Key(long x, long y)
            {
                return x.ToString(CultureInfo.InvariantCulture) + ":"
                    + y.ToString(CultureInfo.InvariantCulture);
            }
            static void Add<T>(IDictionary<string, List<T>> index, string key, T value)
            {
                List<T> values;
                if (!index.TryGetValue(key, out values))
                {
                    values = new List<T>();
                    index[key] = values;
                }
                values.Add(value);
            }
        }

        sealed class TargetContext
        {
            public readonly Dictionary<string, PlanarVertexRecord> Vertices =
                new Dictionary<string, PlanarVertexRecord>(StringComparer.Ordinal);
            public readonly Dictionary<string, SegmentReference> Segments =
                new Dictionary<string, SegmentReference>(StringComparer.Ordinal);
            public readonly Dictionary<string, double> EdgeTolerances =
                new Dictionary<string, double>(StringComparer.Ordinal);
            public readonly Dictionary<string, List<string>> EdgeRegions = NewStringLists();
            public readonly Dictionary<string, List<string>> EdgeProfiles = NewStringLists();
            public readonly Dictionary<string, List<string>> EdgeFeatures = NewStringLists();
            public readonly Dictionary<string, List<string>> EdgeObjects = NewStringLists();
            public SpatialIndex Index;
            public double MaximumTolerance;
            public double TieTolerance;
            public bool EdgeBudgetTruncated;

            static Dictionary<string, List<string>> NewStringLists()
            {
                return new Dictionary<string, List<string>>(StringComparer.Ordinal);
            }
        }

        public static IList<DimensionGeometryPlacementObservation> CreatePlacements(
            DimensionTopologyDocument dimensions,
            BlockInstanceCoordinateDocument instances)
        {
            if (dimensions == null) { throw new ArgumentNullException("dimensions"); }
            if (instances == null) { throw new ArgumentNullException("instances"); }
            var edges = dimensions.Edges.ToDictionary(value => value.Handle, StringComparer.OrdinalIgnoreCase);
            var result = new List<DimensionGeometryPlacementObservation>();
            foreach (InstanceOccurrenceRecord occurrence in instances.Occurrences
                .OrderBy(value => value.Id, StringComparer.Ordinal))
            {
                DimensionEdgeRecord edge;
                if (occurrence == null || occurrence.IsBlockReference
                    || !edges.TryGetValue(occurrence.SourceHandle, out edge))
                {
                    continue;
                }
                result.Add(CreatePlacement(
                    edge,
                    occurrence.Id,
                    occurrence.SourceDefinitionHandle,
                    occurrence.SourceDefinitionName,
                    occurrence.InstancePath,
                    occurrence.WorldTransform,
                    occurrence.Visible,
                    occurrence.Status));
            }
            return result;
        }

        public static DimensionGeometryPlacementObservation CreatePlacement(
            DimensionEdgeRecord edge,
            string occurrenceId,
            string sourceDefinitionHandle,
            string sourceDefinitionName,
            IEnumerable<string> instancePath,
            InstanceAffineTransformObservation worldTransform,
            bool visible,
            string occurrenceStatus)
        {
            return new DimensionGeometryPlacementObservation(
                edge,
                occurrenceId,
                sourceDefinitionHandle,
                sourceDefinitionName,
                instancePath,
                worldTransform,
                visible,
                occurrenceStatus);
        }

        public static DimensionGeometryBindingDocument Analyze(
            DimensionTopologyDocument dimensions,
            BlockInstanceCoordinateDocument instances,
            EngineeringViewRegionDocument regions,
            PlanarTopologyDocument topology,
            ManufacturingProfileFeatureDocument manufacturing,
            MechanicalInterfaceAdjacencyDocument interfaces,
            DimensionGeometryBindingConfig config = null)
        {
            return Analyze(
                dimensions,
                CreatePlacements(dimensions, instances),
                regions,
                topology,
                manufacturing,
                interfaces,
                config);
        }

        public static DimensionGeometryBindingDocument Analyze(
            DimensionTopologyDocument dimensions,
            IList<DimensionGeometryPlacementObservation> placementValues,
            EngineeringViewRegionDocument regions,
            PlanarTopologyDocument topology,
            ManufacturingProfileFeatureDocument manufacturing,
            MechanicalInterfaceAdjacencyDocument interfaces,
            DimensionGeometryBindingConfig config = null)
        {
            if (dimensions == null) { throw new ArgumentNullException("dimensions"); }
            if (regions == null) { throw new ArgumentNullException("regions"); }
            if (topology == null) { throw new ArgumentNullException("topology"); }
            if (manufacturing == null) { throw new ArgumentNullException("manufacturing"); }
            if (interfaces == null) { throw new ArgumentNullException("interfaces"); }
            config = config ?? new DimensionGeometryBindingConfig();
            var diagnostics = new List<DimensionGeometryBindingDiagnosticRecord>();
            ValidateDrawingIds(dimensions, regions, topology, manufacturing, interfaces, diagnostics);
            TargetContext context = BuildTargetContext(
                regions,
                topology,
                manufacturing,
                interfaces,
                config,
                diagnostics);

            var edgesByHandle = dimensions.Edges.ToDictionary(
                value => value.Handle,
                StringComparer.OrdinalIgnoreCase);
            List<DimensionGeometryPlacementObservation> allPlacements = placementValues == null
                ? new List<DimensionGeometryPlacementObservation>()
                : placementValues.Where(value => value != null)
                    .OrderBy(value => value.DimensionHandle, StringComparer.OrdinalIgnoreCase)
                    .ThenBy(value => value.OccurrenceId, StringComparer.Ordinal)
                    .ToList();
            var allPlacedHandles = new HashSet<string>(
                allPlacements.Select(value => value.DimensionHandle),
                StringComparer.OrdinalIgnoreCase);
            int inputPlacementCount = allPlacements.Count;
            int placementLimit = Math.Max(0, config.MaximumPlacementCount);
            if (allPlacements.Count > placementLimit)
            {
                allPlacements = allPlacements.Take(placementLimit).ToList();
                diagnostics.Add(new DimensionGeometryBindingDiagnosticRecord(
                    "DIMENSION_PLACEMENT_LIMIT_REACHED",
                    "unsupported",
                    dimensions.DrawingId,
                    "Dimension placements were deterministically truncated at the configured limit."));
            }

            var bindings = new List<DimensionGeometryBindingRecord>();
            foreach (DimensionGeometryPlacementObservation placement in allPlacements)
            {
                DimensionEdgeRecord edge;
                if (!edgesByHandle.TryGetValue(placement.DimensionHandle, out edge))
                {
                    AddDiagnosticOnce(
                        diagnostics,
                        "PLACEMENT_WITHOUT_DIMENSION_EDGE",
                        "ambiguous",
                        placement.DimensionHandle,
                        "A placement could not be matched back to a 09 linear dimension edge.");
                    continue;
                }
                bindings.Add(BuildBinding(edge, placement, context, config, diagnostics));
            }

            var unplaced = dimensions.Edges
                .Where(value => !allPlacedHandles.Contains(value.Handle))
                .Select(value => value.Handle)
                .OrderBy(value => value, StringComparer.OrdinalIgnoreCase)
                .ToList();
            foreach (DimensionEdgeRecord edge in dimensions.Edges
                .Where(value => !allPlacedHandles.Contains(value.Handle)))
            {
                bindings.Add(BuildUnplacedBinding(edge, config));
            }

            List<DimensionDisplayScaleHypothesisRecord> scaleHypotheses =
                InferDisplayScaleHypotheses(bindings, config);
            var objectSummaries = bindings
                .SelectMany(binding => binding.PhysicalObjectClusterIds.Select(
                    objectId => new { ObjectId = objectId, Binding = binding }))
                .GroupBy(value => value.ObjectId, StringComparer.Ordinal)
                .Select(group => new DimensionGeometryObjectSummaryRecord(
                    group.Key,
                    group.Select(value => value.Binding)))
                .ToList();
            return new DimensionGeometryBindingDocument(
                dimensions.DrawingId,
                regions.Status,
                topology.Status,
                manufacturing.Status,
                interfaces.Status,
                dimensions.Edges.Count,
                inputPlacementCount,
                allPlacements.Count,
                unplaced,
                bindings,
                scaleHypotheses,
                objectSummaries,
                diagnostics);
        }

        static List<DimensionDisplayScaleHypothesisRecord> InferDisplayScaleHypotheses(
            IList<DimensionGeometryBindingRecord> bindings,
            DimensionGeometryBindingConfig config)
        {
            var candidates = new List<ScaleCandidate>();
            foreach (DimensionGeometryBindingRecord binding in bindings)
            {
                DimensionGeometryComparisonRecord comparison = binding.Comparison;
                if (binding.Status != "bound_unique"
                    || binding.IsReferenceDimensionCandidate
                    || binding.RegionIds.Count != 1
                    || comparison == null
                    || comparison.DisplayNumericComparisonOperator != "exact"
                    || (comparison.DisplayOverrideStatus != "numeric_text_override"
                        && comparison.DisplayOverrideStatus
                            != "numeric_text_override_with_additional_values")
                    || !comparison.EffectiveDisplayedValue.HasValue
                    || Math.Abs(comparison.EffectiveDisplayedValue.Value) <= 0.000000000001
                    || !comparison.SourceUnitGeometrySpanMinimum.HasValue
                    || !comparison.SourceUnitGeometrySpanMaximum.HasValue)
                {
                    continue;
                }
                double minimum = comparison.SourceUnitGeometrySpanMinimum.Value;
                double maximum = comparison.SourceUnitGeometrySpanMaximum.Value;
                if (Math.Abs(maximum - minimum) > ComparisonTolerance(minimum, config))
                {
                    continue;
                }
                double ratio = ((minimum + maximum) * 0.5)
                    / Math.Abs(comparison.EffectiveDisplayedValue.Value);
                if (!IsFinite(ratio) || ratio <= 0
                    || Math.Abs(ratio - 1.0) < Math.Max(0, config.MinimumNonUnitScaleDifference))
                {
                    continue;
                }
                candidates.Add(new ScaleCandidate
                {
                    Binding = binding,
                    RegionId = binding.RegionIds[0],
                    DimensionStyle = binding.DimensionStyle,
                    Ratio = ratio,
                    GeometrySpan = (minimum + maximum) * 0.5,
                    DisplayValue = comparison.EffectiveDisplayedValue.Value
                });
            }

            var hypotheses = new List<DimensionDisplayScaleHypothesisRecord>();
            foreach (IGrouping<string, ScaleCandidate> group in candidates.GroupBy(
                value => value.RegionId + "\u001f" + value.DimensionStyle,
                StringComparer.Ordinal))
            {
                var clusters = new List<ScaleCluster>();
                foreach (ScaleCandidate candidate in group.OrderBy(value => value.Ratio))
                {
                    ScaleCluster matched = null;
                    foreach (ScaleCluster cluster in clusters)
                    {
                        double denominator = Math.Max(
                            Math.Abs(cluster.MeanRatio),
                            Math.Abs(candidate.Ratio));
                        double relative = denominator <= 0
                            ? 0
                            : Math.Abs(candidate.Ratio - cluster.MeanRatio) / denominator;
                        if (relative <= Math.Max(0, config.ScaleRatioRelativeTolerance))
                        {
                            matched = cluster;
                            break;
                        }
                    }
                    if (matched == null)
                    {
                        matched = new ScaleCluster
                        {
                            RegionId = candidate.RegionId,
                            DimensionStyle = candidate.DimensionStyle
                        };
                        clusters.Add(matched);
                    }
                    matched.Candidates.Add(candidate);
                }
                foreach (ScaleCluster cluster in clusters.Where(
                    value => value.Candidates.Count
                        >= Math.Max(2, config.MinimumScaleHypothesisSupport)))
                {
                    double ratio = cluster.MeanRatio;
                    double spread = cluster.Candidates.Max(value =>
                        Math.Abs(value.Ratio - ratio) / Math.Max(Math.Abs(ratio), 0.000000000001));
                    string id = "dimension-display-scale:" + Hash(new[]
                    {
                        cluster.RegionId,
                        cluster.DimensionStyle,
                        ratio.ToString("G12", CultureInfo.InvariantCulture)
                    });
                    var record = new DimensionDisplayScaleHypothesisRecord(
                        id,
                        cluster.RegionId,
                        cluster.DimensionStyle,
                        ratio,
                        spread,
                        cluster.Candidates.Select(value => value.Binding),
                        cluster.Candidates.Select(value => value.Ratio));
                    hypotheses.Add(record);
                    foreach (ScaleCandidate candidate in cluster.Candidates)
                    {
                        double residual = candidate.GeometrySpan
                            - Math.Abs(candidate.DisplayValue) * ratio;
                        double tolerance = ComparisonTolerance(candidate.GeometrySpan, config);
                        string status = Math.Abs(residual) <= tolerance
                            ? "within_inferred_scale_numeric_tolerance_candidate"
                            : "outside_inferred_scale_numeric_tolerance_candidate";
                        candidate.Binding.AttachDisplayScaleHypothesis(
                            id, ratio, residual, status);
                    }
                }
            }
            return hypotheses.OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
        }

        static DimensionGeometryBindingRecord BuildBinding(
            DimensionEdgeRecord edge,
            DimensionGeometryPlacementObservation placement,
            TargetContext context,
            DimensionGeometryBindingConfig config,
            IList<DimensionGeometryBindingDiagnosticRecord> diagnostics)
        {
            string id = "dimension-geometry-binding:" + Hash(new[]
            {
                edge.Handle,
                placement.OccurrenceId
            });
            if (!placement.Visible)
            {
                DimensionGeometryComparisonRecord notVisibleComparison = BuildComparison(
                    edge, placement, null, null, config, false, diagnostics, id);
                return new DimensionGeometryBindingRecord(
                    id, edge, placement, "source_occurrence_not_visible",
                    "no_structural_geometry_link", null, null, notVisibleComparison,
                    null, null, null, null);
            }
            if (!placement.IsTransformUsable
                || Math.Abs(placement.XLine1Z) > config.PlanarZTolerance
                || Math.Abs(placement.XLine2Z) > config.PlanarZTolerance)
            {
                diagnostics.Add(new DimensionGeometryBindingDiagnosticRecord(
                    "DIMENSION_PLACEMENT_NOT_IN_SUPPORTED_PLANE",
                    "unsupported",
                    id,
                    "The dimension placement has a singular projected axis or definition points outside the supported topology plane."));
                DimensionGeometryComparisonRecord unsupportedComparison = BuildComparison(
                    edge, placement, null, null, config, false, diagnostics, id);
                return new DimensionGeometryBindingRecord(
                    id, edge, placement, "unsupported_placement_transform_or_plane",
                    "no_structural_geometry_link", null, null, unsupportedComparison,
                    null, null, null, null);
            }

            DimensionEndpointBindingRecord first = BindEndpoint(
                "xline1", placement.XLine1X, placement.XLine1Y, placement.XLine1Z,
                context, config, diagnostics, id);
            DimensionEndpointBindingRecord second = BindEndpoint(
                "xline2", placement.XLine2X, placement.XLine2Y, placement.XLine2Z,
                context, config, diagnostics, id);
            string status;
            if (first.Candidates.Count == 0 && second.Candidates.Count == 0) { status = "unbound"; }
            else if (first.Candidates.Count == 0 || second.Candidates.Count == 0) { status = "partially_bound"; }
            else if (first.IsUnique && second.IsUnique) { status = "bound_unique"; }
            else { status = "bound_ambiguous"; }

            List<string> regionIds = Associations(first, second, value => value.RegionIds);
            List<string> profileIds = Associations(first, second, value => value.ProfileIds);
            List<string> featureIds = Associations(first, second, value => value.InterfaceFeatureIds);
            List<string> objectIds = Associations(first, second, value => value.PhysicalObjectClusterIds);
            string linkKind = LinkKind(first, second);
            DimensionGeometryComparisonRecord comparison = BuildComparison(
                edge, placement, first, second, config, true, diagnostics, id);
            return new DimensionGeometryBindingRecord(
                id, edge, placement, status, linkKind, first, second, comparison,
                regionIds, profileIds, featureIds, objectIds);
        }

        static DimensionGeometryBindingRecord BuildUnplacedBinding(
            DimensionEdgeRecord edge,
            DimensionGeometryBindingConfig config)
        {
            string id = "dimension-geometry-binding:" + Hash(new[] { edge.Handle, "unplaced" });
            DimensionGeometryComparisonRecord comparison = BuildComparison(
                edge, null, null, null, config, false,
                new List<DimensionGeometryBindingDiagnosticRecord>(), id);
            return new DimensionGeometryBindingRecord(
                id, edge, null, "unplaced_source_definition",
                "no_structural_geometry_link", null, null, comparison,
                null, null, null, null);
        }

        static DimensionEndpointBindingRecord BindEndpoint(
            string role,
            double x,
            double y,
            double z,
            TargetContext context,
            DimensionGeometryBindingConfig config,
            IList<DimensionGeometryBindingDiagnosticRecord> diagnostics,
            string bindingId)
        {
            var raw = new List<RawAnchor>();
            foreach (PlanarVertexRecord vertex in context.Index.QueryVertices(
                x, y, context.MaximumTolerance))
            {
                double tolerance = VertexTolerance(vertex, context);
                double distance = Distance(x, y, vertex.X, vertex.Y);
                if (distance <= tolerance)
                {
                    raw.Add(new RawAnchor
                    {
                        Kind = "topology_vertex",
                        Vertex = vertex,
                        X = vertex.X,
                        Y = vertex.Y,
                        Distance = distance,
                        Tolerance = tolerance
                    });
                }
            }
            foreach (SegmentReference segment in context.Index.QuerySegments(
                x, y, context.MaximumTolerance))
            {
                double tolerance;
                if (!context.EdgeTolerances.TryGetValue(segment.Edge.Id, out tolerance)) { continue; }
                double closestX;
                double closestY;
                double distance = PointSegmentDistance(
                    x, y,
                    segment.Start.X, segment.Start.Y,
                    segment.End.X, segment.End.Y,
                    out closestX, out closestY);
                if (distance <= tolerance)
                {
                    raw.Add(new RawAnchor
                    {
                        Kind = "topology_edge_interior",
                        Edge = segment.Edge,
                        X = closestX,
                        Y = closestY,
                        Distance = distance,
                        Tolerance = tolerance
                    });
                }
            }
            if (raw.Count == 0)
            {
                return new DimensionEndpointBindingRecord(
                    role, x, y, z, "unbound_no_engineering_geometry_within_tolerance",
                    false, null);
            }
            double minimum = raw.Min(value => value.Distance);
            List<RawAnchor> retained = raw
                .Where(value => value.Distance <= minimum + context.TieTolerance)
                .OrderBy(value => value.Distance)
                .ThenBy(value => value.Kind == "topology_vertex" ? 0 : 1)
                .ThenBy(value => value.Vertex == null ? value.Edge.Id : value.Vertex.Id, StringComparer.Ordinal)
                .ToList();
            var retainedVertexIds = new HashSet<string>(
                retained.Where(value => value.Vertex != null).Select(value => value.Vertex.Id),
                StringComparer.Ordinal);
            retained = retained.Where(value => value.Edge == null
                || (!retainedVertexIds.Contains(value.Edge.StartVertexId)
                    && !retainedVertexIds.Contains(value.Edge.EndVertexId))).ToList();
            bool truncated = retained.Count > Math.Max(1, config.MaximumCandidatesPerEndpoint);
            if (truncated)
            {
                retained = retained.Take(Math.Max(1, config.MaximumCandidatesPerEndpoint)).ToList();
                AddDiagnosticOnce(
                    diagnostics,
                    "ENDPOINT_CANDIDATE_LIMIT_REACHED",
                    "unsupported",
                    bindingId,
                    "At least one endpoint anchor candidate list was truncated at the configured limit.");
            }
            var candidates = retained.Select(value => CreateCandidate(value, context)).ToList();
            string status = truncated
                ? "ambiguous_candidate_budget_truncated"
                : candidates.Count == 1
                    ? "unique_geometry_anchor"
                    : "ambiguous_geometry_anchors_at_equal_distance";
            return new DimensionEndpointBindingRecord(role, x, y, z, status, truncated, candidates);
        }

        static DimensionGeometryAnchorCandidateRecord CreateCandidate(
            RawAnchor raw,
            TargetContext context)
        {
            List<string> edges = raw.Vertex == null
                ? new List<string> { raw.Edge.Id }
                : raw.Vertex.IncidentEdgeIds.Where(context.Segments.ContainsKey).ToList();
            List<string> regions = LookupMany(context.EdgeRegions, edges);
            List<string> profiles = LookupMany(context.EdgeProfiles, edges);
            List<string> features = LookupMany(context.EdgeFeatures, edges);
            List<string> objects = LookupMany(context.EdgeObjects, edges);
            var handles = new List<string>();
            var qualities = new List<string>();
            foreach (string edgeId in edges)
            {
                SegmentReference segment;
                if (!context.Segments.TryGetValue(edgeId, out segment)) { continue; }
                foreach (PlanarEdgeSupportRecord support in segment.Edge.Supports)
                {
                    handles.Add(support.SourceHandle);
                    qualities.Add(support.GeometryQuality);
                }
            }
            string anchorId = raw.Vertex == null ? raw.Edge.Id : raw.Vertex.Id;
            return new DimensionGeometryAnchorCandidateRecord(
                "dimension-anchor:" + Hash(new[] { raw.Kind, anchorId }),
                raw.Kind,
                raw.Vertex == null ? "" : raw.Vertex.Id,
                edges,
                raw.X,
                raw.Y,
                raw.Distance,
                raw.Tolerance,
                regions,
                profiles,
                features,
                objects,
                handles,
                qualities);
        }

        static DimensionGeometryComparisonRecord BuildComparison(
            DimensionEdgeRecord edge,
            DimensionGeometryPlacementObservation placement,
            DimensionEndpointBindingRecord first,
            DimensionEndpointBindingRecord second,
            DimensionGeometryBindingConfig config,
            bool calculateGeometry,
            IList<DimensionGeometryBindingDiagnosticRecord> diagnostics,
            string sourceId)
        {
            DisplayInterpretation display = InterpretDisplay(edge);
            var worldSpans = new List<double>();
            bool combinationsTruncated = false;
            if (calculateGeometry && placement != null && placement.AxisScale > 0
                && first != null && second != null
                && first.Candidates.Count > 0 && second.Candidates.Count > 0)
            {
                int maximum = Math.Max(1, config.MaximumCandidateCombinations);
                foreach (DimensionGeometryAnchorCandidateRecord left in first.Candidates)
                {
                    foreach (DimensionGeometryAnchorCandidateRecord right in second.Candidates)
                    {
                        if (worldSpans.Count >= maximum)
                        {
                            combinationsTruncated = true;
                            break;
                        }
                        worldSpans.Add(Math.Abs(
                            (right.X - left.X) * placement.AxisX
                            + (right.Y - left.Y) * placement.AxisY));
                    }
                    if (combinationsTruncated) { break; }
                }
            }
            if (combinationsTruncated)
            {
                AddDiagnosticOnce(
                    diagnostics,
                    "MEASUREMENT_COMBINATION_LIMIT_REACHED",
                    "unsupported",
                    sourceId,
                    "Ambiguous endpoint combinations were truncated before all projected spans were evaluated.");
            }
            double? worldMin = worldSpans.Count == 0 ? (double?)null : worldSpans.Min();
            double? worldMax = worldSpans.Count == 0 ? (double?)null : worldSpans.Max();
            double? sourceMin = worldMin.HasValue && placement != null && placement.AxisScale > 0
                ? (double?)(worldMin.Value / placement.AxisScale)
                : null;
            double? sourceMax = worldMax.HasValue && placement != null && placement.AxisScale > 0
                ? (double?)(worldMax.Value / placement.AxisScale)
                : null;
            string determinacy = !sourceMin.HasValue
                ? "not_available"
                : combinationsTruncated
                    ? "candidate_combination_budget_truncated"
                    : worldSpans.Count == 1
                        ? "unique_anchor_pair"
                        : Math.Abs(sourceMax.Value - sourceMin.Value)
                            <= ComparisonTolerance(edge.HasMeasurement ? edge.Measurement : sourceMin.Value, config)
                            ? "stable_span_across_ambiguous_anchor_pairs"
                            : "span_range_from_ambiguous_anchor_pairs";

            double? entityResidualMin = edge.HasMeasurement && sourceMin.HasValue
                ? (double?)(sourceMin.Value - edge.Measurement)
                : null;
            double? entityResidualMax = edge.HasMeasurement && sourceMax.HasValue
                ? (double?)(sourceMax.Value - edge.Measurement)
                : null;
            double? entityTolerance = edge.HasMeasurement
                ? (double?)ComparisonTolerance(edge.Measurement, config)
                : null;
            string entityStatus = ComparisonStatus(
                sourceMin, sourceMax,
                edge.HasMeasurement ? (double?)edge.Measurement : null,
                entityTolerance,
                combinationsTruncated,
                "exact");

            double displayGeometryFactor = display.AppliesAuthoredLinearFactor
                && edge.HasLinearMeasurementFactor
                    ? edge.LinearMeasurementFactor
                    : 1.0;
            string displayGeometryBasis = display.AppliesAuthoredLinearFactor
                && edge.HasLinearMeasurementFactor
                    ? "source_dimension_unit_geometry_times_authored_dimlfac"
                    : "source_dimension_unit_geometry";
            double? displayGeometryMin = sourceMin.HasValue
                ? (double?)(sourceMin.Value * displayGeometryFactor)
                : null;
            double? displayGeometryMax = sourceMax.HasValue
                ? (double?)(sourceMax.Value * displayGeometryFactor)
                : null;
            double? displayResidualMin = display.EffectiveValue.HasValue && displayGeometryMin.HasValue
                ? (double?)(displayGeometryMin.Value - display.EffectiveValue.Value)
                : null;
            double? displayResidualMax = display.EffectiveValue.HasValue && displayGeometryMax.HasValue
                ? (double?)(displayGeometryMax.Value - display.EffectiveValue.Value)
                : null;
            double? displayTolerance = display.EffectiveValue.HasValue
                ? (double?)ComparisonTolerance(display.EffectiveValue.Value, config)
                : null;
            string displayStatus = ComparisonStatus(
                displayGeometryMin, displayGeometryMax,
                display.EffectiveValue,
                displayTolerance,
                combinationsTruncated,
                display.Operator);
            if (!display.EffectiveValue.HasValue && !string.IsNullOrEmpty(edge.DimensionText))
            {
                displayStatus = "display_text_not_numeric_geometry_comparison_not_applicable";
            }
            string primary = display.EffectiveValue.HasValue ? displayStatus : entityStatus;
            return new DimensionGeometryComparisonRecord(
                display.Status,
                display.Operator,
                displayGeometryBasis,
                display.Tokens,
                display.EffectiveValue,
                display.EffectiveSource,
                worldMin,
                worldMax,
                sourceMin,
                sourceMax,
                determinacy,
                worldSpans.Count,
                combinationsTruncated,
                entityResidualMin,
                entityResidualMax,
                displayResidualMin,
                displayResidualMax,
                entityTolerance,
                displayTolerance,
                entityStatus,
                displayStatus,
                primary);
        }

        static DisplayInterpretation InterpretDisplay(DimensionEdgeRecord edge)
        {
            var result = new DisplayInterpretation { Operator = "not_comparable" };
            string raw = edge == null ? "" : edge.DimensionText ?? "";
            bool diameterDesignator = raw.IndexOf("%%c", StringComparison.OrdinalIgnoreCase) >= 0
                || raw.IndexOf('Φ') >= 0 || raw.IndexOf('φ') >= 0
                || raw.IndexOf('Ø') >= 0 || raw.IndexOf('ø') >= 0;
            string cleaned = Regex.Replace(raw, @"\\[A-Za-z][^;]*;", "");
            cleaned = Regex.Replace(cleaned, @"%%[A-Za-z]", "");
            string semantic = cleaned.Replace("{", "").Replace("}", "").Trim();
            bool placeholder = cleaned.IndexOf("<>", StringComparison.Ordinal) >= 0;
            foreach (Match match in Regex.Matches(
                cleaned.Replace("<>", ""),
                @"[-+]?(?:\d+(?:\.\d*)?|\.\d+)"))
            {
                double value;
                if (double.TryParse(match.Value, NumberStyles.Float,
                    CultureInfo.InvariantCulture, out value))
                {
                    result.Tokens.Add(value);
                }
            }
            if (string.IsNullOrWhiteSpace(raw))
            {
                result.Status = "no_text_override";
                result.Operator = "exact";
                result.AppliesAuthoredLinearFactor = edge != null
                    && edge.HasLinearMeasurementFactor;
                if (edge != null && edge.HasMeasurement)
                {
                    result.EffectiveValue = FormattedEntityMeasurement(edge);
                    result.EffectiveSource = edge.HasLinearMeasurementFactor
                        ? "dimension_entity_measurement_times_authored_dimlfac"
                        : "dimension_entity_measurement";
                }
            }
            else if (placeholder)
            {
                result.Status = result.Tokens.Count == 0
                    ? "measurement_placeholder"
                    : "measurement_placeholder_with_additional_numeric_text";
                result.Operator = "exact";
                result.AppliesAuthoredLinearFactor = edge != null
                    && edge.HasLinearMeasurementFactor;
                if (edge != null && edge.HasMeasurement)
                {
                    result.EffectiveValue = FormattedEntityMeasurement(edge);
                    result.EffectiveSource = edge.HasLinearMeasurementFactor
                        ? "dimension_entity_measurement_times_authored_dimlfac_via_text_placeholder"
                        : "dimension_entity_measurement_via_text_placeholder";
                }
            }
            else if (Regex.IsMatch(semantic, @"^M\s*\d", RegexOptions.IgnoreCase))
            {
                result.Status = "thread_designation_text_override";
                result.EffectiveSource = "not_comparable_as_linear_distance";
            }
            else if (Regex.IsMatch(semantic, @"^R\s*\d", RegexOptions.IgnoreCase))
            {
                result.Status = "radius_designation_on_linear_dimension_candidate";
                result.EffectiveSource = "not_comparable_without_radial_geometry_model";
            }
            else if (result.Tokens.Count > 0)
            {
                bool lowerBound = semantic.IndexOf('≥') >= 0
                    || semantic.IndexOf(">=", StringComparison.Ordinal) >= 0
                    || semantic.StartsWith(">", StringComparison.Ordinal);
                bool upperBound = semantic.IndexOf('≤') >= 0
                    || semantic.IndexOf("<=", StringComparison.Ordinal) >= 0
                    || semantic.StartsWith("<", StringComparison.Ordinal);
                if (lowerBound)
                {
                    result.Status = "lower_bound_numeric_text_override";
                    result.Operator = "at_least";
                }
                else if (upperBound)
                {
                    result.Status = "upper_bound_numeric_text_override";
                    result.Operator = "at_most";
                }
                else if (diameterDesignator)
                {
                    result.Status = "diameter_numeric_text_override";
                    result.Operator = "exact";
                }
                else
                {
                    result.Status = result.Tokens.Count == 1
                        ? "numeric_text_override"
                        : "numeric_text_override_with_additional_values";
                    result.Operator = "exact";
                }
                result.EffectiveValue = result.Tokens[0];
                result.EffectiveSource = "first_display_numeric_token_after_cad_format_stripping";
            }
            else
            {
                result.Status = "non_numeric_text_override";
                result.EffectiveSource = "not_available";
            }
            return result;
        }

        static string ComparisonStatus(
            double? minimum,
            double? maximum,
            double? reference,
            double? tolerance,
            bool truncated,
            string comparisonOperator)
        {
            if (!minimum.HasValue || !maximum.HasValue || !reference.HasValue || !tolerance.HasValue)
            {
                return "not_comparable";
            }
            if (truncated) { return "not_comparable_candidate_budget_truncated"; }
            if (comparisonOperator == "at_least")
            {
                if (minimum.Value >= reference.Value - tolerance.Value)
                {
                    return "satisfies_displayed_lower_bound_candidate";
                }
                if (maximum.Value < reference.Value - tolerance.Value)
                {
                    return "outside_displayed_lower_bound_candidate";
                }
                return "ambiguous_span_range_crosses_displayed_lower_bound";
            }
            if (comparisonOperator == "at_most")
            {
                if (maximum.Value <= reference.Value + tolerance.Value)
                {
                    return "satisfies_displayed_upper_bound_candidate";
                }
                if (minimum.Value > reference.Value + tolerance.Value)
                {
                    return "outside_displayed_upper_bound_candidate";
                }
                return "ambiguous_span_range_crosses_displayed_upper_bound";
            }
            if (comparisonOperator != "exact") { return "not_comparable"; }
            double low = minimum.Value - reference.Value;
            double high = maximum.Value - reference.Value;
            if (Math.Max(Math.Abs(low), Math.Abs(high)) <= tolerance.Value)
            {
                return "within_configured_numeric_tolerance";
            }
            if (high < -tolerance.Value || low > tolerance.Value)
            {
                return "outside_configured_numeric_tolerance_candidate";
            }
            return "ambiguous_span_range_crosses_configured_tolerance";
        }

        static double FormattedEntityMeasurement(DimensionEdgeRecord edge)
        {
            double factor = edge != null && edge.HasLinearMeasurementFactor
                ? edge.LinearMeasurementFactor
                : 1.0;
            return edge == null ? 0 : edge.Measurement * factor;
        }

        static double ComparisonTolerance(double reference, DimensionGeometryBindingConfig config)
        {
            return Math.Max(
                Math.Max(0, config.AbsoluteComparisonTolerance),
                Math.Abs(reference) * Math.Max(0, config.RelativeComparisonTolerance));
        }

        static TargetContext BuildTargetContext(
            EngineeringViewRegionDocument regions,
            PlanarTopologyDocument topology,
            ManufacturingProfileFeatureDocument manufacturing,
            MechanicalInterfaceAdjacencyDocument interfaces,
            DimensionGeometryBindingConfig config,
            IList<DimensionGeometryBindingDiagnosticRecord> diagnostics)
        {
            var context = new TargetContext();
            double minimumTolerance = Math.Max(topology.GridSize * 4.0, 0.000000001);
            var eligibleIds = new HashSet<string>(StringComparer.Ordinal);
            foreach (EngineeringViewRegionRecord region in regions.Regions
                .Where(value => value.IsEngineeringView)
                .OrderBy(value => value.Id, StringComparer.Ordinal))
            {
                double span = Math.Max(region.Width, region.Height);
                double tolerance = Math.Max(
                    minimumTolerance,
                    span * Math.Max(0, config.EndpointToleranceRatio));
                context.MaximumTolerance = Math.Max(context.MaximumTolerance, tolerance);
                foreach (string edgeId in region.EdgeIds)
                {
                    eligibleIds.Add(edgeId);
                    Add(context.EdgeRegions, edgeId, region.Id);
                    double existing;
                    context.EdgeTolerances.TryGetValue(edgeId, out existing);
                    context.EdgeTolerances[edgeId] = Math.Max(existing, tolerance);
                }
            }
            context.MaximumTolerance = Math.Max(context.MaximumTolerance, minimumTolerance);
            context.TieTolerance = Math.Max(
                topology.GridSize * 2.0,
                context.MaximumTolerance * Math.Max(0, config.CandidateTieToleranceRatio));

            List<string> sortedEligible = eligibleIds.OrderBy(value => value, StringComparer.Ordinal).ToList();
            int edgeLimit = Math.Max(0, config.MaximumIndexedEdgeCount);
            if (sortedEligible.Count > edgeLimit)
            {
                sortedEligible = sortedEligible.Take(edgeLimit).ToList();
                context.EdgeBudgetTruncated = true;
                diagnostics.Add(new DimensionGeometryBindingDiagnosticRecord(
                    "GEOMETRY_INDEX_EDGE_LIMIT_REACHED",
                    "unsupported",
                    topology.DrawingId,
                    "Engineering-view topology edges were deterministically truncated before indexing."));
            }
            var selectedIds = new HashSet<string>(sortedEligible, StringComparer.Ordinal);
            var topologyVertices = topology.Vertices.ToDictionary(value => value.Id, StringComparer.Ordinal);
            double minX = double.PositiveInfinity;
            double minY = double.PositiveInfinity;
            double maxX = double.NegativeInfinity;
            double maxY = double.NegativeInfinity;
            foreach (PlanarEdgeRecord edge in topology.Edges)
            {
                if (!selectedIds.Contains(edge.Id)) { continue; }
                PlanarVertexRecord start;
                PlanarVertexRecord end;
                if (!topologyVertices.TryGetValue(edge.StartVertexId, out start)
                    || !topologyVertices.TryGetValue(edge.EndVertexId, out end))
                {
                    continue;
                }
                context.Vertices[start.Id] = start;
                context.Vertices[end.Id] = end;
                context.Segments[edge.Id] = new SegmentReference
                {
                    Edge = edge,
                    Start = start,
                    End = end
                };
                minX = Math.Min(minX, Math.Min(start.X, end.X));
                minY = Math.Min(minY, Math.Min(start.Y, end.Y));
                maxX = Math.Max(maxX, Math.Max(start.X, end.X));
                maxY = Math.Max(maxY, Math.Max(start.Y, end.Y));
            }
            AddProfileAssociations(manufacturing, context);
            AddInterfaceAssociations(interfaces, context);
            double drawingSpan = double.IsInfinity(minX)
                ? context.MaximumTolerance
                : Math.Max(maxX - minX, maxY - minY);
            double cellSize = Math.Max(
                context.MaximumTolerance * 2.0,
                Math.Max(topology.GridSize * 8.0, drawingSpan / 1024.0));
            context.Index = new SpatialIndex(cellSize, config.MaximumIndexCellsPerEdge);
            foreach (PlanarVertexRecord vertex in context.Vertices.Values) { context.Index.AddVertex(vertex); }
            foreach (SegmentReference segment in context.Segments.Values) { context.Index.AddSegment(segment); }
            return context;
        }

        static void AddProfileAssociations(
            ManufacturingProfileFeatureDocument manufacturing,
            TargetContext context)
        {
            foreach (ManufacturingProfileRecord profile in manufacturing.Profiles)
            {
                foreach (string edgeId in profile.BoundaryEdgeIds)
                {
                    if (!context.Segments.ContainsKey(edgeId)) { continue; }
                    Add(context.EdgeProfiles, edgeId, profile.Id);
                    Add(context.EdgeObjects, edgeId, profile.PhysicalObjectClusterId);
                }
            }
        }

        static void AddInterfaceAssociations(
            MechanicalInterfaceAdjacencyDocument interfaces,
            TargetContext context)
        {
            foreach (MechanicalInterfaceFeatureRecord feature in interfaces.Features)
            {
                foreach (string edgeId in feature.BoundaryEdgeIds)
                {
                    if (!context.Segments.ContainsKey(edgeId)) { continue; }
                    Add(context.EdgeFeatures, edgeId, feature.Id);
                    Add(context.EdgeObjects, edgeId, feature.PhysicalObjectClusterId);
                }
            }
        }

        static void ValidateDrawingIds(
            DimensionTopologyDocument dimensions,
            EngineeringViewRegionDocument regions,
            PlanarTopologyDocument topology,
            ManufacturingProfileFeatureDocument manufacturing,
            MechanicalInterfaceAdjacencyDocument interfaces,
            IList<DimensionGeometryBindingDiagnosticRecord> diagnostics)
        {
            string expected = dimensions.DrawingId ?? "";
            if (regions.DrawingId != expected || topology.DrawingId != expected
                || manufacturing.DrawingId != expected || interfaces.DrawingId != expected)
            {
                diagnostics.Add(new DimensionGeometryBindingDiagnosticRecord(
                    "SOURCE_DRAWING_ID_MISMATCH",
                    "unsupported",
                    expected,
                    "18 inputs do not all carry the same drawing_id; results remain evidence-only."));
            }
        }

        static List<string> Associations(
            DimensionEndpointBindingRecord first,
            DimensionEndpointBindingRecord second,
            Func<DimensionGeometryAnchorCandidateRecord, IList<string>> selector)
        {
            IEnumerable<DimensionGeometryAnchorCandidateRecord> values =
                (first == null ? Enumerable.Empty<DimensionGeometryAnchorCandidateRecord>() : first.Candidates)
                .Concat(second == null ? Enumerable.Empty<DimensionGeometryAnchorCandidateRecord>() : second.Candidates);
            return DimensionGeometryBindingMaps.SortedUnique(values.SelectMany(selector));
        }

        static string LinkKind(
            DimensionEndpointBindingRecord first,
            DimensionEndpointBindingRecord second)
        {
            if (first == null || second == null
                || first.Candidates.Count == 0 || second.Candidates.Count == 0)
            {
                return first != null && second != null
                    && (first.Candidates.Count > 0 || second.Candidates.Count > 0)
                        ? "single_endpoint_structural_attachment_candidate"
                        : "no_structural_geometry_link";
            }
            if (Intersects(first, second, value => value.InterfaceFeatureIds))
            {
                return "interface_feature_span_candidate";
            }
            if (Intersects(first, second, value => value.ProfileIds))
            {
                return "intra_profile_span_candidate";
            }
            if (Intersects(first, second, value => value.PhysicalObjectClusterIds))
            {
                return "intra_object_projected_span_candidate";
            }
            if (Intersects(first, second, value => value.RegionIds))
            {
                return "intra_view_structural_span_candidate";
            }
            return "cross_region_structural_span_candidate";
        }

        static bool Intersects(
            DimensionEndpointBindingRecord first,
            DimensionEndpointBindingRecord second,
            Func<DimensionGeometryAnchorCandidateRecord, IList<string>> selector)
        {
            var left = new HashSet<string>(first.Candidates.SelectMany(selector), StringComparer.Ordinal);
            return second.Candidates.SelectMany(selector).Any(left.Contains);
        }

        static double VertexTolerance(PlanarVertexRecord vertex, TargetContext context)
        {
            double tolerance = 0;
            foreach (string edgeId in vertex.IncidentEdgeIds)
            {
                double value;
                if (context.EdgeTolerances.TryGetValue(edgeId, out value))
                {
                    tolerance = Math.Max(tolerance, value);
                }
            }
            return tolerance;
        }

        static List<string> LookupMany(
            IDictionary<string, List<string>> values,
            IEnumerable<string> keys)
        {
            var result = new List<string>();
            foreach (string key in keys)
            {
                List<string> found;
                if (values.TryGetValue(key, out found)) { result.AddRange(found); }
            }
            return DimensionGeometryBindingMaps.SortedUnique(result);
        }

        static void Add(
            IDictionary<string, List<string>> values,
            string key,
            string value)
        {
            if (string.IsNullOrEmpty(key) || string.IsNullOrEmpty(value)) { return; }
            List<string> found;
            if (!values.TryGetValue(key, out found))
            {
                found = new List<string>();
                values[key] = found;
            }
            if (!found.Contains(value)) { found.Add(value); }
        }

        static void AddDiagnosticOnce(
            IList<DimensionGeometryBindingDiagnosticRecord> values,
            string code,
            string status,
            string sourceId,
            string message)
        {
            if (values.Any(value => value.Code == code && value.SourceId == sourceId)) { return; }
            values.Add(new DimensionGeometryBindingDiagnosticRecord(
                code, status, sourceId, message));
        }

        static double PointSegmentDistance(
            double px,
            double py,
            double ax,
            double ay,
            double bx,
            double by,
            out double closestX,
            out double closestY)
        {
            double dx = bx - ax;
            double dy = by - ay;
            double lengthSquared = dx * dx + dy * dy;
            double parameter = lengthSquared <= 0
                ? 0
                : ((px - ax) * dx + (py - ay) * dy) / lengthSquared;
            parameter = Math.Max(0, Math.Min(1, parameter));
            closestX = ax + parameter * dx;
            closestY = ay + parameter * dy;
            return Distance(px, py, closestX, closestY);
        }

        static double Distance(double ax, double ay, double bx, double by)
        {
            double dx = ax - bx;
            double dy = ay - by;
            return Math.Sqrt(dx * dx + dy * dy);
        }

        static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }

        static string Hash(IEnumerable<string> values)
        {
            string joined = string.Join("\u001f", values == null
                ? new string[0]
                : values.Select(value => value ?? "").ToArray());
            using (SHA256 sha = SHA256.Create())
            {
                byte[] bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(joined));
                var builder = new StringBuilder();
                for (int index = 0; index < 8; index++)
                {
                    builder.Append(bytes[index].ToString("x2", CultureInfo.InvariantCulture));
                }
                return builder.ToString();
            }
        }
    }

    static class DimensionGeometryBindingMaps
    {
        public static Dictionary<string, object> Map(params object[] values)
        {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            for (int index = 0; index + 1 < values.Length; index += 2)
            {
                result[Convert.ToString(values[index], CultureInfo.InvariantCulture)] = values[index + 1];
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
                : values.Where(value => !string.IsNullOrEmpty(value))
                    .Distinct(StringComparer.Ordinal)
                    .OrderBy(value => value, StringComparer.Ordinal)
                    .ToList();
        }

        public static List<string> SortedUniquePreserveOrder(IEnumerable<string> values)
        {
            var result = new List<string>();
            var seen = new HashSet<string>(StringComparer.Ordinal);
            if (values == null) { return result; }
            foreach (string value in values)
            {
                if (!string.IsNullOrEmpty(value) && seen.Add(value)) { result.Add(value); }
            }
            return result;
        }
    }
}
