using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Shb.Cad.Core
{
    public sealed class DimensionTopologyObservation
    {
        public DimensionTopologyObservation(
            string handle,
            string runtimeClass,
            string dimensionType,
            string layer,
            string ownerScope,
            string ownerBlockName)
        {
            Handle = handle ?? "";
            RuntimeClass = runtimeClass ?? "";
            DimensionType = dimensionType ?? "";
            Layer = layer ?? "";
            OwnerScope = ownerScope ?? "";
            OwnerBlockName = ownerBlockName ?? "";
            DimensionText = "";
            DimensionStyle = "";
            AssociationHandle = "";
        }

        public string Handle { get; private set; }
        public string RuntimeClass { get; private set; }
        public string DimensionType { get; private set; }
        public string Layer { get; private set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public bool HasMeasurement { get; private set; }
        public double Measurement { get; private set; }
        public string DimensionText { get; private set; }
        public string DimensionStyle { get; private set; }
        public bool HasAxisAngle { get; private set; }
        public double AxisAngleRadians { get; private set; }
        public bool HasXLine1Point { get; private set; }
        public double XLine1X { get; private set; }
        public double XLine1Y { get; private set; }
        public bool HasXLine2Point { get; private set; }
        public double XLine2X { get; private set; }
        public double XLine2Y { get; private set; }
        public bool HasDimensionLinePoint { get; private set; }
        public double DimensionLineX { get; private set; }
        public double DimensionLineY { get; private set; }
        public bool HasTextPosition { get; private set; }
        public double TextX { get; private set; }
        public double TextY { get; private set; }
        public bool HasBounds { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }
        public string AssociationHandle { get; private set; }
        public bool HasLinearMeasurementFactor { get; private set; }
        public double LinearMeasurementFactor { get; private set; }

        public DimensionTopologyObservation SetMeasurement(
            double? measurement,
            string dimensionText,
            string dimensionStyle)
        {
            if (measurement.HasValue
                && IsFinite(measurement.Value))
            {
                HasMeasurement = true;
                Measurement = measurement.Value;
            }
            DimensionText = dimensionText ?? "";
            DimensionStyle = dimensionStyle ?? "";
            return this;
        }

        public DimensionTopologyObservation SetAxisAngle(double? radians)
        {
            if (radians.HasValue && IsFinite(radians.Value))
            {
                HasAxisAngle = true;
                AxisAngleRadians = radians.Value;
            }
            return this;
        }

        public DimensionTopologyObservation SetXLine1Point(double x, double y)
        {
            if (IsFinite(x) && IsFinite(y))
            {
                HasXLine1Point = true;
                XLine1X = x;
                XLine1Y = y;
            }
            return this;
        }

        public DimensionTopologyObservation SetXLine2Point(double x, double y)
        {
            if (IsFinite(x) && IsFinite(y))
            {
                HasXLine2Point = true;
                XLine2X = x;
                XLine2Y = y;
            }
            return this;
        }

        public DimensionTopologyObservation SetDimensionLinePoint(double x, double y)
        {
            if (IsFinite(x) && IsFinite(y))
            {
                HasDimensionLinePoint = true;
                DimensionLineX = x;
                DimensionLineY = y;
            }
            return this;
        }

        public DimensionTopologyObservation SetTextPosition(double x, double y)
        {
            if (IsFinite(x) && IsFinite(y))
            {
                HasTextPosition = true;
                TextX = x;
                TextY = y;
            }
            return this;
        }

        public DimensionTopologyObservation SetBounds(
            double minX,
            double minY,
            double maxX,
            double maxY)
        {
            if (IsFinite(minX) && IsFinite(minY)
                && IsFinite(maxX) && IsFinite(maxY))
            {
                HasBounds = true;
                MinX = Math.Min(minX, maxX);
                MinY = Math.Min(minY, maxY);
                MaxX = Math.Max(minX, maxX);
                MaxY = Math.Max(minY, maxY);
            }
            return this;
        }

        public DimensionTopologyObservation SetAssociationHandle(string handle)
        {
            AssociationHandle = handle ?? "";
            return this;
        }

        public DimensionTopologyObservation SetLinearMeasurementFactor(double? value)
        {
            if (value.HasValue && IsFinite(value.Value))
            {
                HasLinearMeasurementFactor = true;
                LinearMeasurementFactor = value.Value;
            }
            return this;
        }

        static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }
    }

    public sealed class DimensionReferenceAxisObservation
    {
        public DimensionReferenceAxisObservation(
            string handle,
            string name,
            string ownerScope,
            string ownerBlockName,
            double startX,
            double startY,
            double endX,
            double endY)
        {
            Handle = handle ?? "";
            Name = name ?? "";
            OwnerScope = ownerScope ?? "";
            OwnerBlockName = ownerBlockName ?? "";
            StartX = startX;
            StartY = startY;
            EndX = endX;
            EndY = endY;
        }

        public string Handle { get; private set; }
        public string Name { get; private set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public double StartX { get; private set; }
        public double StartY { get; private set; }
        public double EndX { get; private set; }
        public double EndY { get; private set; }
    }

    public sealed class DimensionTopologyConfig
    {
        public DimensionTopologyConfig()
        {
            StationTolerance = 0.05;
            AxisToleranceDegrees = 0.5;
            LaneTolerance = 2.0;
            DatumPairLaneTolerance = 5.0;
            NormalTolerance = 2.0;
            NormalGapSpanFactor = 0.30;
            EquationAbsoluteTolerance = 0.05;
            EquationRelativeTolerance = 0.000001;
            ReferenceAxisAngleToleranceDegrees = 0.5;
            ReferenceAxisStationTolerance = 0.10;
        }

        public double StationTolerance { get; set; }
        public double AxisToleranceDegrees { get; set; }
        public double LaneTolerance { get; set; }
        public double DatumPairLaneTolerance { get; set; }
        public double NormalTolerance { get; set; }
        public double NormalGapSpanFactor { get; set; }
        public double EquationAbsoluteTolerance { get; set; }
        public double EquationRelativeTolerance { get; set; }
        public double ReferenceAxisAngleToleranceDegrees { get; set; }
        public double ReferenceAxisStationTolerance { get; set; }
    }

    public sealed class DimensionEdgeRecord
    {
        readonly List<string> chainIds;

        internal DimensionEdgeRecord(DimensionTopologyObservation source)
        {
            Source = source;
            Id = "dimension-edge:" + source.Handle;
            Handle = source.Handle;
            RuntimeClass = source.RuntimeClass;
            DimensionType = source.DimensionType;
            Layer = source.Layer;
            OwnerScope = source.OwnerScope;
            OwnerBlockName = source.OwnerBlockName;
            Measurement = source.Measurement;
            HasMeasurement = source.HasMeasurement;
            DimensionText = source.DimensionText;
            DimensionStyle = source.DimensionStyle;
            AssociationHandle = source.AssociationHandle;
            HasLinearMeasurementFactor = source.HasLinearMeasurementFactor;
            LinearMeasurementFactor = source.LinearMeasurementFactor;
            IsReferenceDimensionCandidate = HasReferenceParentheses(source.DimensionText);
            chainIds = new List<string>();
        }

        internal DimensionTopologyObservation Source { get; private set; }
        public string Id { get; private set; }
        public string Handle { get; private set; }
        public string RuntimeClass { get; private set; }
        public string DimensionType { get; private set; }
        public string Layer { get; private set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public string AxisGroupId { get; internal set; }
        public string TopologyGroupId { get; internal set; }
        public string StartNodeId { get; internal set; }
        public string EndNodeId { get; internal set; }
        public double AxisX { get; internal set; }
        public double AxisY { get; internal set; }
        public double NormalX { get; internal set; }
        public double NormalY { get; internal set; }
        public double StartStation { get; internal set; }
        public double EndStation { get; internal set; }
        public double Lane { get; internal set; }
        public double NormalMin { get; internal set; }
        public double NormalMax { get; internal set; }
        public double GeometricSpan { get; internal set; }
        public bool HasMeasurement { get; private set; }
        public double Measurement { get; private set; }
        public double MeasurementResidual
        {
            get { return HasMeasurement ? Measurement - GeometricSpan : double.NaN; }
        }
        public string DimensionText { get; private set; }
        public string DimensionStyle { get; private set; }
        public string AssociationHandle { get; private set; }
        public bool HasLinearMeasurementFactor { get; private set; }
        public double LinearMeasurementFactor { get; private set; }
        public bool IsReferenceDimensionCandidate { get; private set; }
        public IList<string> ChainIds { get { return chainIds.AsReadOnly(); } }
        public bool HasXLine1Point { get { return Source != null && Source.HasXLine1Point; } }
        public double XLine1X { get { return Source == null ? 0 : Source.XLine1X; } }
        public double XLine1Y { get { return Source == null ? 0 : Source.XLine1Y; } }
        public bool HasXLine2Point { get { return Source != null && Source.HasXLine2Point; } }
        public double XLine2X { get { return Source == null ? 0 : Source.XLine2X; } }
        public double XLine2Y { get { return Source == null ? 0 : Source.XLine2Y; } }
        public bool HasDimensionLinePoint
        {
            get { return Source != null && Source.HasDimensionLinePoint; }
        }
        public double DimensionLineX { get { return Source == null ? 0 : Source.DimensionLineX; } }
        public double DimensionLineY { get { return Source == null ? 0 : Source.DimensionLineY; } }
        public bool HasTextPosition { get { return Source != null && Source.HasTextPosition; } }
        public double TextX { get { return Source == null ? 0 : Source.TextX; } }
        public double TextY { get { return Source == null ? 0 : Source.TextY; } }

        public string OrientationClass
        {
            get
            {
                double degrees = Math.Atan2(AxisY, AxisX) * 180.0 / Math.PI;
                degrees %= 180.0;
                if (degrees < 0)
                {
                    degrees += 180.0;
                }
                if (degrees <= 0.5 || 180.0 - degrees <= 0.5)
                {
                    return "horizontal";
                }
                if (Math.Abs(degrees - 90.0) <= 0.5)
                {
                    return "vertical";
                }
                return "angled";
            }
        }

        internal void AddChain(string id)
        {
            if (!string.IsNullOrEmpty(id) && !chainIds.Contains(id))
            {
                chainIds.Add(id);
            }
        }

        public Dictionary<string, object> ToMap()
        {
            return DimensionTopologyMaps.Map(
                "id", Id,
                "handle", Handle,
                "runtime_class", RuntimeClass,
                "dimension_type", DimensionType,
                "layer", Layer,
                "owner_scope", OwnerScope,
                "owner_block_name", OwnerBlockName,
                "axis_group_id", AxisGroupId,
                "topology_group_id", TopologyGroupId,
                "start_node_id", StartNodeId,
                "end_node_id", EndNodeId,
                "axis", new[] { AxisX, AxisY },
                "normal", new[] { NormalX, NormalY },
                "orientation_class", OrientationClass,
                "start_station", StartStation,
                "end_station", EndStation,
                "geometric_span", GeometricSpan,
                "measurement", HasMeasurement ? (object)Measurement : null,
                "measurement_minus_geometric_span",
                    HasMeasurement ? (object)MeasurementResidual : null,
                "dimension_text", DimensionText,
                "dimension_style", DimensionStyle,
                "lane", Lane,
                "normal_range", new[] { NormalMin, NormalMax },
                "definition_points", DimensionTopologyMaps.Map(
                    "xline1", new[] { Source.XLine1X, Source.XLine1Y },
                    "xline2", new[] { Source.XLine2X, Source.XLine2Y },
                    "dimension_line", new[]
                    {
                        Source.DimensionLineX,
                        Source.DimensionLineY
                    },
                    "text_position", Source.HasTextPosition
                        ? (object)new[] { Source.TextX, Source.TextY }
                        : null),
                "association_handle", AssociationHandle,
                "linear_measurement_factor",
                    HasLinearMeasurementFactor ? (object)LinearMeasurementFactor : null,
                "reference_dimension_candidate", IsReferenceDimensionCandidate,
                "reference_dimension_evidence", IsReferenceDimensionCandidate
                    ? "display_text_contains_parentheses"
                    : "",
                "chain_ids", new List<string>(chainIds));
        }

        static bool HasReferenceParentheses(string value)
        {
            string text = value ?? "";
            return (text.IndexOf('(') >= 0 && text.IndexOf(')') >= 0)
                || (text.IndexOf('（') >= 0 && text.IndexOf('）') >= 0);
        }
    }

    public sealed class DimensionNodeRecord
    {
        readonly List<string> incidentEdgeHandles;

        internal DimensionNodeRecord(string id, string groupId, double station)
        {
            Id = id;
            TopologyGroupId = groupId;
            Station = station;
            incidentEdgeHandles = new List<string>();
        }

        public string Id { get; private set; }
        public string TopologyGroupId { get; private set; }
        public double Station { get; internal set; }
        public IList<string> IncidentEdgeHandles
        {
            get { return incidentEdgeHandles.AsReadOnly(); }
        }

        internal void AddEdge(string handle)
        {
            if (!incidentEdgeHandles.Contains(handle))
            {
                incidentEdgeHandles.Add(handle);
            }
        }

        public Dictionary<string, object> ToMap()
        {
            return DimensionTopologyMaps.Map(
                "id", Id,
                "topology_group_id", TopologyGroupId,
                "station", Station,
                "incident_edge_handles", new List<string>(incidentEdgeHandles));
        }
    }

    public sealed class DimensionRelationRecord
    {
        readonly List<string> evidence;

        internal DimensionRelationRecord(
            string id,
            string type,
            string firstHandle,
            string secondHandle,
            double station)
        {
            Id = id;
            RelationType = type;
            FirstHandle = firstHandle;
            SecondHandle = secondHandle;
            SharedStation = station;
            evidence = new List<string>();
        }

        public string Id { get; private set; }
        public string RelationType { get; private set; }
        public string FirstHandle { get; private set; }
        public string SecondHandle { get; private set; }
        public double SharedStation { get; private set; }
        public IList<string> Evidence { get { return evidence.AsReadOnly(); } }

        internal void AddEvidence(string value)
        {
            if (!string.IsNullOrEmpty(value) && !evidence.Contains(value))
            {
                evidence.Add(value);
            }
        }
        public Dictionary<string, object> ToMap()
        {
            return DimensionTopologyMaps.Map(
                "id", Id,
                "relation_type", RelationType,
                "first_handle", FirstHandle,
                "second_handle", SecondHandle,
                "shared_station", double.IsNaN(SharedStation)
                    ? null
                    : (object)SharedStation,
                "evidence", new List<string>(evidence));
        }
    }

    public sealed class DimensionTopologyGroupRecord
    {
        readonly List<string> edgeHandles;
        readonly List<string> nodeIds;
        readonly List<string> relationIds;

        internal DimensionTopologyGroupRecord(string id)
        {
            Id = id;
            edgeHandles = new List<string>();
            nodeIds = new List<string>();
            relationIds = new List<string>();
        }

        public string Id { get; private set; }
        public IList<string> EdgeHandles { get { return edgeHandles.AsReadOnly(); } }
        public IList<string> NodeIds { get { return nodeIds.AsReadOnly(); } }
        public IList<string> RelationIds { get { return relationIds.AsReadOnly(); } }

        internal void AddEdge(string handle) { edgeHandles.Add(handle); }
        internal void AddNode(string id) { nodeIds.Add(id); }
        internal void AddRelation(string id) { relationIds.Add(id); }

        public Dictionary<string, object> ToMap()
        {
            return DimensionTopologyMaps.Map(
                "id", Id,
                "edge_handles", new List<string>(edgeHandles),
                "node_ids", new List<string>(nodeIds),
                "relation_ids", new List<string>(relationIds),
                "is_isolated", edgeHandles.Count == 1);
        }
    }

    public sealed class DimensionChainRecord
    {
        readonly List<string> edgeHandles;
        readonly List<string> nodeIds;

        internal DimensionChainRecord(
            string id,
            string topologyGroupId,
            IList<DimensionEdgeRecord> edges,
            IList<string> nodes)
        {
            Id = id;
            TopologyGroupId = topologyGroupId;
            edgeHandles = new List<string>();
            nodeIds = new List<string>();
            double laneSum = 0;
            StartStation = double.PositiveInfinity;
            EndStation = double.NegativeInfinity;
            foreach (DimensionEdgeRecord edge in edges)
            {
                edgeHandles.Add(edge.Handle);
                laneSum += edge.Lane;
                StartStation = Math.Min(StartStation, edge.StartStation);
                EndStation = Math.Max(EndStation, edge.EndStation);
            }
            foreach (string node in nodes)
            {
                nodeIds.Add(node);
            }
            AverageLane = edges.Count == 0 ? 0 : laneSum / edges.Count;
        }

        public string Id { get; private set; }
        public string TopologyGroupId { get; private set; }
        public IList<string> EdgeHandles { get { return edgeHandles.AsReadOnly(); } }
        public IList<string> NodeIds { get { return nodeIds.AsReadOnly(); } }
        public double StartStation { get; private set; }
        public double EndStation { get; private set; }
        public double AverageLane { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return DimensionTopologyMaps.Map(
                "id", Id,
                "chain_type", "continuous_endpoint_chain",
                "topology_group_id", TopologyGroupId,
                "edge_handles", new List<string>(edgeHandles),
                "node_ids", new List<string>(nodeIds),
                "start_station", StartStation,
                "end_station", EndStation,
                "span", EndStation - StartStation,
                "average_lane", AverageLane,
                "evidence", new[]
                {
                    "parallel_linear_dimensions",
                    "shared_endpoint_station",
                    "same_dimension_lane"
                });
        }
    }

    public sealed class DimensionEquationRecord
    {
        readonly List<string> sourceHandles;
        readonly List<string> evidence;

        internal DimensionEquationRecord(
            string id,
            string type,
            string leftExpression,
            string rightExpression,
            double leftValue,
            double rightValue,
            IList<string> handles,
            bool withinTolerance)
        {
            Id = id;
            EquationType = type;
            LeftExpression = leftExpression;
            RightExpression = rightExpression;
            LeftValue = leftValue;
            RightValue = rightValue;
            Residual = leftValue - rightValue;
            WithinTolerance = withinTolerance;
            sourceHandles = new List<string>();
            evidence = new List<string>();
            if (handles != null)
            {
                foreach (string handle in handles)
                {
                    if (!sourceHandles.Contains(handle))
                    {
                        sourceHandles.Add(handle);
                    }
                }
            }
        }

        public string Id { get; private set; }
        public string EquationType { get; private set; }
        public string LeftExpression { get; private set; }
        public string RightExpression { get; private set; }
        public double LeftValue { get; private set; }
        public double RightValue { get; private set; }
        public double Residual { get; private set; }
        public bool WithinTolerance { get; private set; }
        public IList<string> SourceHandles { get { return sourceHandles.AsReadOnly(); } }
        public IList<string> Evidence { get { return evidence.AsReadOnly(); } }

        internal void AddEvidence(string value)
        {
            if (!string.IsNullOrEmpty(value) && !evidence.Contains(value))
            {
                evidence.Add(value);
            }
        }

        public Dictionary<string, object> ToMap()
        {
            return DimensionTopologyMaps.Map(
                "id", Id,
                "equation_type", EquationType,
                "left_expression", LeftExpression,
                "right_expression", RightExpression,
                "left_value", LeftValue,
                "right_value", RightValue,
                "residual", Residual,
                "within_tolerance", WithinTolerance,
                "source_handles", new List<string>(sourceHandles),
                "evidence", new List<string>(evidence));
        }
    }

    public sealed class DerivedDimensionRecord
    {
        readonly List<string> sourceHandles;

        internal DerivedDimensionRecord(
            string id,
            string type,
            double startStation,
            double endStation,
            double value,
            IList<string> handles,
            string explicitDimensionHandle,
            double? explicitResidual)
        {
            Id = id;
            DerivationType = type;
            StartStation = Math.Min(startStation, endStation);
            EndStation = Math.Max(startStation, endStation);
            Value = value;
            ExplicitDimensionHandle = explicitDimensionHandle ?? "";
            HasExplicitResidual = explicitResidual.HasValue;
            ExplicitResidual = explicitResidual.HasValue ? explicitResidual.Value : 0;
            sourceHandles = new List<string>();
            if (handles != null)
            {
                foreach (string handle in handles)
                {
                    if (!sourceHandles.Contains(handle))
                    {
                        sourceHandles.Add(handle);
                    }
                }
            }
        }

        public string Id { get; private set; }
        public string DerivationType { get; private set; }
        public double StartStation { get; private set; }
        public double EndStation { get; private set; }
        public double Value { get; private set; }
        public string ExplicitDimensionHandle { get; private set; }
        public bool HasExplicitResidual { get; private set; }
        public double ExplicitResidual { get; private set; }
        public IList<string> SourceHandles { get { return sourceHandles.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return DimensionTopologyMaps.Map(
                "id", Id,
                "derivation_type", DerivationType,
                "start_station", StartStation,
                "end_station", EndStation,
                "value", Value,
                "source_handles", new List<string>(sourceHandles),
                "explicit_dimension_handle", ExplicitDimensionHandle,
                "explicit_dimension_residual", HasExplicitResidual
                    ? (object)ExplicitResidual
                    : null,
                "semantic_status", "derived_not_drawn_unless_explicit_handle_present");
        }
    }

    public sealed class DimensionDatumPairRecord
    {
        internal DimensionDatumPairRecord(
            string id,
            DimensionEdgeRecord left,
            DimensionEdgeRecord right,
            double datumStation,
            DimensionEdgeRecord explicitSpan)
        {
            Id = id;
            LeftHandle = left.Handle;
            RightHandle = right.Handle;
            LeftOffset = datumStation - left.StartStation;
            RightOffset = right.EndStation - datumStation;
            TotalSpan = LeftOffset + RightOffset;
            MidpointOffset = (RightOffset - LeftOffset) / 2.0;
            LaneDifference = Math.Abs(left.Lane - right.Lane);
            EnvelopeStartStation = left.StartStation;
            EnvelopeEndStation = right.EndStation;
            ExplicitSpanHandle = explicitSpan == null ? "" : explicitSpan.Handle;
            HasExplicitSpanResidual = explicitSpan != null && explicitSpan.HasMeasurement;
            ExplicitSpanResidual = HasExplicitSpanResidual
                ? explicitSpan.Measurement - TotalSpan
                : 0;
        }

        public string Id { get; private set; }
        public string LeftHandle { get; private set; }
        public string RightHandle { get; private set; }
        public double LeftOffset { get; private set; }
        public double RightOffset { get; private set; }
        public double TotalSpan { get; private set; }
        public double MidpointOffset { get; private set; }
        public double LaneDifference { get; private set; }
        public double EnvelopeStartStation { get; private set; }
        public double EnvelopeEndStation { get; private set; }
        public string ExplicitSpanHandle { get; private set; }
        public bool HasExplicitSpanResidual { get; private set; }
        public double ExplicitSpanResidual { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return DimensionTopologyMaps.Map(
                "id", Id,
                "left_handle", LeftHandle,
                "right_handle", RightHandle,
                "left_offset", LeftOffset,
                "right_offset", RightOffset,
                "left_right_difference", RightOffset - LeftOffset,
                "total_span", TotalSpan,
                "midpoint_offset_from_datum", MidpointOffset,
                "lane_difference", LaneDifference,
                "envelope", new[] { EnvelopeStartStation, EnvelopeEndStation },
                "explicit_span_handle", ExplicitSpanHandle,
                "explicit_span_residual", HasExplicitSpanResidual
                    ? (object)ExplicitSpanResidual
                    : null);
        }
    }

    public sealed class DimensionLayerIncrementRecord
    {
        internal DimensionLayerIncrementRecord(
            string id,
            DimensionDatumPairRecord inner,
            DimensionDatumPairRecord outer)
        {
            Id = id;
            InnerPairId = inner.Id;
            OuterPairId = outer.Id;
            LeftIncrement = outer.LeftOffset - inner.LeftOffset;
            RightIncrement = outer.RightOffset - inner.RightOffset;
            EqualityResidual = RightIncrement - LeftIncrement;
            LeftInnerHandle = inner.LeftHandle;
            LeftOuterHandle = outer.LeftHandle;
            RightInnerHandle = inner.RightHandle;
            RightOuterHandle = outer.RightHandle;
        }

        public string Id { get; private set; }
        public string InnerPairId { get; private set; }
        public string OuterPairId { get; private set; }
        public double LeftIncrement { get; private set; }
        public double RightIncrement { get; private set; }
        public double EqualityResidual { get; private set; }
        public string LeftInnerHandle { get; private set; }
        public string LeftOuterHandle { get; private set; }
        public string RightInnerHandle { get; private set; }
        public string RightOuterHandle { get; private set; }

        internal IList<string> Handles()
        {
            return new[]
            {
                LeftInnerHandle,
                LeftOuterHandle,
                RightInnerHandle,
                RightOuterHandle
            };
        }

        public Dictionary<string, object> ToMap()
        {
            return DimensionTopologyMaps.Map(
                "id", Id,
                "inner_pair_id", InnerPairId,
                "outer_pair_id", OuterPairId,
                "left_increment", LeftIncrement,
                "right_increment", RightIncrement,
                "equality_residual", EqualityResidual,
                "source_handles", new[]
                {
                    LeftInnerHandle,
                    LeftOuterHandle,
                    RightInnerHandle,
                    RightOuterHandle
                });
        }
    }

    public sealed class DimensionDatumProfileRecord
    {
        readonly List<DimensionDatumPairRecord> pairs;
        readonly List<DimensionLayerIncrementRecord> increments;
        readonly List<string> evidence;

        internal DimensionDatumProfileRecord(
            string id,
            string topologyGroupId,
            string ownerScope,
            string ownerBlockName,
            double datumStation,
            double axisX,
            double axisY,
            DimensionReferenceAxisObservation referenceAxis)
        {
            Id = id;
            TopologyGroupId = topologyGroupId;
            OwnerScope = ownerScope;
            OwnerBlockName = ownerBlockName;
            DatumStation = datumStation;
            AxisX = axisX;
            AxisY = axisY;
            ReferenceAxisHandle = referenceAxis == null ? "" : referenceAxis.Handle;
            ReferenceAxisName = referenceAxis == null ? "" : referenceAxis.Name;
            ReferenceAxisStatus = referenceAxis == null
                ? "shared_dimension_datum_candidate"
                : "matched_named_reference_axis";
            pairs = new List<DimensionDatumPairRecord>();
            increments = new List<DimensionLayerIncrementRecord>();
            evidence = new List<string>();
        }

        public string Id { get; private set; }
        public string TopologyGroupId { get; private set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public double DatumStation { get; private set; }
        public double AxisX { get; private set; }
        public double AxisY { get; private set; }
        public string ReferenceAxisHandle { get; private set; }
        public string ReferenceAxisName { get; private set; }
        public string ReferenceAxisStatus { get; private set; }
        public IList<DimensionDatumPairRecord> Pairs { get { return pairs.AsReadOnly(); } }
        public IList<DimensionLayerIncrementRecord> Increments
        {
            get { return increments.AsReadOnly(); }
        }
        public IList<string> Evidence { get { return evidence.AsReadOnly(); } }
        public bool HasConstantMidpointOffset { get; internal set; }
        public double ConstantMidpointOffset { get; internal set; }

        internal void AddPair(DimensionDatumPairRecord pair) { pairs.Add(pair); }
        internal void AddIncrement(DimensionLayerIncrementRecord increment)
        {
            increments.Add(increment);
        }
        internal void AddEvidence(string value)
        {
            if (!string.IsNullOrEmpty(value) && !evidence.Contains(value))
            {
                evidence.Add(value);
            }
        }
        internal void SortPairsByTotalSpan()
        {
            pairs.Sort(delegate(
                DimensionDatumPairRecord left,
                DimensionDatumPairRecord right)
            {
                return left.TotalSpan.CompareTo(right.TotalSpan);
            });
        }

        public Dictionary<string, object> ToMap()
        {
            var pairMaps = new List<Dictionary<string, object>>();
            var incrementMaps = new List<Dictionary<string, object>>();
            foreach (DimensionDatumPairRecord pair in pairs)
            {
                pairMaps.Add(pair.ToMap());
            }
            foreach (DimensionLayerIncrementRecord increment in increments)
            {
                incrementMaps.Add(increment.ToMap());
            }
            return DimensionTopologyMaps.Map(
                "id", Id,
                "topology_group_id", TopologyGroupId,
                "owner_scope", OwnerScope,
                "owner_block_name", OwnerBlockName,
                "datum_station", DatumStation,
                "dimension_axis", new[] { AxisX, AxisY },
                "reference_axis_handle", ReferenceAxisHandle,
                "reference_axis_name", ReferenceAxisName,
                "reference_axis_status", ReferenceAxisStatus,
                "pair_count", pairs.Count,
                "pairs", pairMaps,
                "layer_increments", incrementMaps,
                "constant_midpoint_offset", HasConstantMidpointOffset
                    ? (object)ConstantMidpointOffset
                    : null,
                "symmetry_status", HasConstantMidpointOffset
                    ? (Math.Abs(ConstantMidpointOffset) <= 0.05
                        ? "centered_on_reference_axis"
                        : "constant_eccentricity_from_reference_axis")
                    : "not_established",
                "evidence", new List<string>(evidence));
        }
    }

    public sealed class DimensionTopologyDocument
    {
        readonly List<DimensionEdgeRecord> edges;
        readonly List<DimensionNodeRecord> nodes;
        readonly List<DimensionRelationRecord> relations;
        readonly List<DimensionTopologyGroupRecord> groups;
        readonly List<DimensionChainRecord> chains;
        readonly List<DimensionEquationRecord> equations;
        readonly List<DerivedDimensionRecord> derivedDimensions;
        readonly List<DimensionDatumProfileRecord> datumProfiles;
        readonly List<string> isolatedHandles;
        readonly Dictionary<string, int> unsupportedTypeCounts;

        internal DimensionTopologyDocument(
            string drawingId,
            IList<DimensionEdgeRecord> edgesValue,
            IList<DimensionNodeRecord> nodesValue,
            IList<DimensionRelationRecord> relationsValue,
            IList<DimensionTopologyGroupRecord> groupsValue,
            IList<DimensionChainRecord> chainsValue,
            IList<DimensionEquationRecord> equationsValue,
            IList<DerivedDimensionRecord> derivedValue,
            IList<DimensionDatumProfileRecord> profilesValue,
            IList<string> isolatedValue,
            IDictionary<string, int> unsupportedCounts)
        {
            DrawingId = drawingId ?? "";
            edges = Copy(edgesValue);
            nodes = Copy(nodesValue);
            relations = Copy(relationsValue);
            groups = Copy(groupsValue);
            chains = Copy(chainsValue);
            equations = Copy(equationsValue);
            derivedDimensions = Copy(derivedValue);
            datumProfiles = Copy(profilesValue);
            isolatedHandles = isolatedValue == null
                ? new List<string>()
                : new List<string>(isolatedValue);
            unsupportedTypeCounts = unsupportedCounts == null
                ? new Dictionary<string, int>(StringComparer.Ordinal)
                : new Dictionary<string, int>(unsupportedCounts, StringComparer.Ordinal);
        }

        public string DrawingId { get; private set; }
        public IList<DimensionEdgeRecord> Edges { get { return edges.AsReadOnly(); } }
        public IList<DimensionNodeRecord> Nodes { get { return nodes.AsReadOnly(); } }
        public IList<DimensionRelationRecord> Relations { get { return relations.AsReadOnly(); } }
        public IList<DimensionTopologyGroupRecord> Groups { get { return groups.AsReadOnly(); } }
        public IList<DimensionChainRecord> Chains { get { return chains.AsReadOnly(); } }
        public IList<DimensionEquationRecord> Equations { get { return equations.AsReadOnly(); } }
        public IList<DerivedDimensionRecord> DerivedDimensions
        {
            get { return derivedDimensions.AsReadOnly(); }
        }
        public IList<DimensionDatumProfileRecord> DatumProfiles
        {
            get { return datumProfiles.AsReadOnly(); }
        }
        public IList<string> IsolatedHandles { get { return isolatedHandles.AsReadOnly(); } }
        public int UnsupportedDimensionCount
        {
            get
            {
                int total = 0;
                foreach (int value in unsupportedTypeCounts.Values)
                {
                    total += value;
                }
                return total;
            }
        }
        public int ReferenceDimensionCandidateCount
        {
            get
            {
                int count = 0;
                foreach (DimensionEdgeRecord edge in edges)
                {
                    if (edge.IsReferenceDimensionCandidate)
                    {
                        count++;
                    }
                }
                return count;
            }
        }

        public Dictionary<string, object> ToMap()
        {
            return DimensionTopologyMaps.Map(
                "schema_version", "1",
                "analysis_type", "dimension_topology",
                "analyzer_version", "1",
                "drawing_id", DrawingId,
                "linear_dimension_count", edges.Count,
                "unsupported_dimension_count", UnsupportedDimensionCount,
                "unsupported_dimension_type_counts",
                    new Dictionary<string, int>(unsupportedTypeCounts, StringComparer.Ordinal),
                "node_count", nodes.Count,
                "relation_count", relations.Count,
                "topology_group_count", groups.Count,
                "continuous_chain_count", chains.Count,
                "equation_count", equations.Count,
                "derived_dimension_count", derivedDimensions.Count,
                "datum_profile_count", datumProfiles.Count,
                "reference_dimension_candidate_count", ReferenceDimensionCandidateCount,
                "isolated_dimension_handles", new List<string>(isolatedHandles),
                "edges", Maps(edges),
                "nodes", Maps(nodes),
                "relations", Maps(relations),
                "topology_groups", Maps(groups),
                "continuous_chains", Maps(chains),
                "equations", Maps(equations),
                "derived_dimensions", Maps(derivedDimensions),
                "datum_profiles", Maps(datumProfiles),
                "semantic_boundary", DimensionTopologyMaps.Map(
                    "exact", new[]
                    {
                        "definition_points",
                        "axis_projection",
                        "shared_stations",
                        "measurements",
                        "equation_residuals"
                    },
                    "derived", new[]
                    {
                        "chains",
                        "common_datums",
                        "envelopes",
                        "layer_increments",
                        "midpoint_offsets"
                    },
                    "not_inferred", new[]
                    {
                        "component_business_name",
                        "design_intent",
                        "missing_dimension_requirement"
                    }));
        }

        public string ToMarkdown()
        {
            var sb = new StringBuilder();
            sb.AppendLine("# 尺寸拓扑与尺寸链分析");
            sb.AppendLine();
            sb.AppendLine("- 图纸：`" + DrawingId + "`");
            sb.AppendLine("- 线性尺寸：" + edges.Count.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("- 连续尺寸链：" + chains.Count.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("- 数值闭合关系：" + equations.Count.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("- 共基准剖面：" + datumProfiles.Count.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("- 派生距离：" + derivedDimensions.Count.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine();
            if (datumProfiles.Count > 0)
            {
                sb.AppendLine("## 共基准与偏心");
                sb.AppendLine();
                foreach (DimensionDatumProfileRecord profile in datumProfiles)
                {
                    string label = string.IsNullOrEmpty(profile.ReferenceAxisName)
                        ? "未命名基准"
                        : profile.ReferenceAxisName;
                    sb.AppendLine("- `" + profile.Id + "`：" + label
                        + "，站位 " + Format(profile.DatumStation)
                        + "，左右配对 " + profile.Pairs.Count.ToString(CultureInfo.InvariantCulture)
                        + (profile.HasConstantMidpointOffset
                            ? "，恒定中点偏置 " + Format(profile.ConstantMidpointOffset)
                            : ""));
                }
                sb.AppendLine();
            }
            if (equations.Count > 0)
            {
                sb.AppendLine("## 闭合等式");
                sb.AppendLine();
                foreach (DimensionEquationRecord equation in equations)
                {
                    sb.AppendLine("- " + equation.LeftExpression + " = "
                        + equation.RightExpression + "；残差 " + Format(equation.Residual)
                        + (equation.WithinTolerance ? "（闭合）" : "（不闭合）"));
                }
                sb.AppendLine();
            }
            sb.AppendLine("## 边界");
            sb.AppendLine();
            sb.AppendLine("派生距离不是原图新增标注；构件名称和设计意图仍需结合关联几何、文字及局部出图判断。");
            return sb.ToString().TrimEnd();
        }

        static List<T> Copy<T>(IList<T> source)
        {
            return source == null ? new List<T>() : new List<T>(source);
        }

        static List<Dictionary<string, object>> Maps<T>(IList<T> source)
        {
            var result = new List<Dictionary<string, object>>();
            foreach (T item in source)
            {
                object value = item;
                DimensionEdgeRecord edge = value as DimensionEdgeRecord;
                if (edge != null) { result.Add(edge.ToMap()); continue; }
                DimensionNodeRecord node = value as DimensionNodeRecord;
                if (node != null) { result.Add(node.ToMap()); continue; }
                DimensionRelationRecord relation = value as DimensionRelationRecord;
                if (relation != null) { result.Add(relation.ToMap()); continue; }
                DimensionTopologyGroupRecord group = value as DimensionTopologyGroupRecord;
                if (group != null) { result.Add(group.ToMap()); continue; }
                DimensionChainRecord chain = value as DimensionChainRecord;
                if (chain != null) { result.Add(chain.ToMap()); continue; }
                DimensionEquationRecord equation = value as DimensionEquationRecord;
                if (equation != null) { result.Add(equation.ToMap()); continue; }
                DerivedDimensionRecord derived = value as DerivedDimensionRecord;
                if (derived != null) { result.Add(derived.ToMap()); continue; }
                DimensionDatumProfileRecord profile = value as DimensionDatumProfileRecord;
                if (profile != null) { result.Add(profile.ToMap()); }
            }
            return result;
        }

        static string Format(double value)
        {
            return value.ToString("0.######", CultureInfo.InvariantCulture);
        }
    }

    public static class DimensionTopologyAnalyzer
    {
        sealed class AxisGroup
        {
            public string Id;
            public string OwnerScope;
            public string OwnerBlockName;
            public double AxisX;
            public double AxisY;
            public readonly List<DimensionEdgeRecord> Edges =
                new List<DimensionEdgeRecord>();
        }

        sealed class PairMatch
        {
            public DimensionEdgeRecord Left;
            public DimensionEdgeRecord Right;
            public double LaneDifference;
        }

        sealed class DisjointSet
        {
            readonly int[] parent;

            public DisjointSet(int count)
            {
                parent = new int[count];
                for (int index = 0; index < count; index++)
                {
                    parent[index] = index;
                }
            }

            public int Find(int value)
            {
                if (parent[value] != value)
                {
                    parent[value] = Find(parent[value]);
                }
                return parent[value];
            }

            public void Union(int left, int right)
            {
                int a = Find(left);
                int b = Find(right);
                if (a != b)
                {
                    parent[b] = a;
                }
            }
        }

        public static DimensionTopologyDocument Analyze(
            string drawingId,
            IList<DimensionTopologyObservation> observations,
            IList<DimensionReferenceAxisObservation> referenceAxes,
            DimensionTopologyConfig config = null)
        {
            config = config ?? new DimensionTopologyConfig();
            var unsupported = new Dictionary<string, int>(StringComparer.Ordinal);
            var edges = BuildEdges(observations, unsupported);
            var axisGroups = BuildAxisGroups(edges, config);
            foreach (AxisGroup axisGroup in axisGroups)
            {
                ProjectEdges(axisGroup);
            }

            var relations = new List<DimensionRelationRecord>();
            var edgeIndexes = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
            for (int index = 0; index < edges.Count; index++)
            {
                edgeIndexes[edges[index].Handle] = index;
            }
            var topologySet = new DisjointSet(edges.Count);
            BuildRelations(axisGroups, config, relations, topologySet, edgeIndexes);

            List<DimensionTopologyGroupRecord> groups;
            List<DimensionNodeRecord> nodes;
            List<string> isolated;
            BuildTopologyGroups(
                edges,
                relations,
                topologySet,
                edgeIndexes,
                config,
                out groups,
                out nodes,
                out isolated);
            List<DimensionChainRecord> chains = BuildChains(
                edges,
                relations,
                edgeIndexes);
            var equations = BuildPartitionEquations(edges, config);
            var derived = new List<DerivedDimensionRecord>();
            var profiles = BuildDatumProfiles(
                edges,
                nodes,
                referenceAxes,
                config,
                equations,
                derived);
            return new DimensionTopologyDocument(
                drawingId,
                edges,
                nodes,
                relations,
                groups,
                chains,
                equations,
                derived,
                profiles,
                isolated,
                unsupported);
        }

        static List<DimensionEdgeRecord> BuildEdges(
            IList<DimensionTopologyObservation> observations,
            IDictionary<string, int> unsupported)
        {
            var edges = new List<DimensionEdgeRecord>();
            if (observations == null)
            {
                return edges;
            }
            foreach (DimensionTopologyObservation observation in observations)
            {
                if (observation == null)
                {
                    continue;
                }
                if (!IsLinearType(observation.DimensionType)
                    || !observation.HasXLine1Point
                    || !observation.HasXLine2Point
                    || !observation.HasDimensionLinePoint)
                {
                    string type = string.IsNullOrEmpty(observation.DimensionType)
                        ? "unknown"
                        : observation.DimensionType;
                    int count;
                    unsupported.TryGetValue(type, out count);
                    unsupported[type] = count + 1;
                    continue;
                }
                var edge = new DimensionEdgeRecord(observation);
                double angle;
                if (observation.HasAxisAngle)
                {
                    angle = observation.AxisAngleRadians;
                }
                else
                {
                    angle = Math.Atan2(
                        observation.XLine2Y - observation.XLine1Y,
                        observation.XLine2X - observation.XLine1X);
                }
                angle = NormalizeAxisAngle(angle);
                edge.AxisX = Math.Cos(angle);
                edge.AxisY = Math.Sin(angle);
                edge.NormalX = -edge.AxisY;
                edge.NormalY = edge.AxisX;
                edges.Add(edge);
            }
            edges.Sort(delegate(DimensionEdgeRecord left, DimensionEdgeRecord right)
            {
                int owner = string.CompareOrdinal(left.OwnerScope, right.OwnerScope);
                if (owner != 0) { return owner; }
                int block = string.CompareOrdinal(left.OwnerBlockName, right.OwnerBlockName);
                return block != 0 ? block : string.CompareOrdinal(left.Handle, right.Handle);
            });
            return edges;
        }

        static List<AxisGroup> BuildAxisGroups(
            IList<DimensionEdgeRecord> edges,
            DimensionTopologyConfig config)
        {
            var groups = new List<AxisGroup>();
            foreach (DimensionEdgeRecord edge in edges)
            {
                AxisGroup matched = null;
                foreach (AxisGroup group in groups)
                {
                    if (!SameOwner(edge, group)
                        || AxisDifferenceDegrees(
                            edge.AxisX,
                            edge.AxisY,
                            group.AxisX,
                            group.AxisY) > config.AxisToleranceDegrees)
                    {
                        continue;
                    }
                    matched = group;
                    break;
                }
                if (matched == null)
                {
                    matched = new AxisGroup
                    {
                        Id = "dimension-axis-" + (groups.Count + 1).ToString(
                            CultureInfo.InvariantCulture),
                        OwnerScope = edge.OwnerScope,
                        OwnerBlockName = edge.OwnerBlockName,
                        AxisX = edge.AxisX,
                        AxisY = edge.AxisY
                    };
                    groups.Add(matched);
                }
                edge.AxisGroupId = matched.Id;
                matched.Edges.Add(edge);
            }
            return groups;
        }

        static void ProjectEdges(AxisGroup group)
        {
            double ux = group.AxisX;
            double uy = group.AxisY;
            double vx = -uy;
            double vy = ux;
            foreach (DimensionEdgeRecord edge in group.Edges)
            {
                edge.AxisX = ux;
                edge.AxisY = uy;
                edge.NormalX = vx;
                edge.NormalY = vy;
                DimensionTopologyObservation source = edge.Source;
                double first = Dot(source.XLine1X, source.XLine1Y, ux, uy);
                double second = Dot(source.XLine2X, source.XLine2Y, ux, uy);
                edge.StartStation = Math.Min(first, second);
                edge.EndStation = Math.Max(first, second);
                edge.GeometricSpan = edge.EndStation - edge.StartStation;
                edge.Lane = Dot(
                    source.DimensionLineX,
                    source.DimensionLineY,
                    vx,
                    vy);
                double n1 = Dot(source.XLine1X, source.XLine1Y, vx, vy);
                double n2 = Dot(source.XLine2X, source.XLine2Y, vx, vy);
                edge.NormalMin = Math.Min(edge.Lane, Math.Min(n1, n2));
                edge.NormalMax = Math.Max(edge.Lane, Math.Max(n1, n2));
                if (source.HasTextPosition)
                {
                    double nt = Dot(source.TextX, source.TextY, vx, vy);
                    edge.NormalMin = Math.Min(edge.NormalMin, nt);
                    edge.NormalMax = Math.Max(edge.NormalMax, nt);
                }
            }
        }

        static void BuildRelations(
            IList<AxisGroup> axisGroups,
            DimensionTopologyConfig config,
            IList<DimensionRelationRecord> output,
            DisjointSet topologySet,
            IDictionary<string, int> edgeIndexes)
        {
            int relationNumber = 0;
            foreach (AxisGroup group in axisGroups)
            {
                for (int firstIndex = 0; firstIndex < group.Edges.Count; firstIndex++)
                {
                    DimensionEdgeRecord first = group.Edges[firstIndex];
                    for (int secondIndex = firstIndex + 1;
                        secondIndex < group.Edges.Count;
                        secondIndex++)
                    {
                        DimensionEdgeRecord second = group.Edges[secondIndex];
                        if (!NormalClose(first, second, config))
                        {
                            continue;
                        }
                        double shared;
                        int sharedCount = SharedEndpointCount(
                            first,
                            second,
                            config.StationTolerance,
                            out shared);
                        if (sharedCount == 2)
                        {
                            AddRelation(
                                "duplicate_interval",
                                first,
                                second,
                                shared,
                                ref relationNumber,
                                output,
                                topologySet,
                                edgeIndexes,
                                "both_endpoint_stations_match");
                        }
                        else if (sharedCount == 1)
                        {
                            double otherFirst = OtherStation(first, shared, config.StationTolerance);
                            double otherSecond = OtherStation(second, shared, config.StationTolerance);
                            bool opposite = (otherFirst - shared) * (otherSecond - shared) < 0;
                            string type;
                            if (opposite
                                && Math.Abs(first.Lane - second.Lane) <= config.LaneTolerance)
                            {
                                type = "continuous_chain";
                            }
                            else if (opposite)
                            {
                                type = "shared_datum_opposite_sides";
                            }
                            else
                            {
                                type = "baseline_common_datum";
                            }
                            AddRelation(
                                type,
                                first,
                                second,
                                shared,
                                ref relationNumber,
                                output,
                                topologySet,
                                edgeIndexes,
                                "one_endpoint_station_matches");
                        }

                        DimensionEdgeRecord parent;
                        DimensionEdgeRecord child;
                        if (StrictlyContains(first, second, config.StationTolerance))
                        {
                            parent = first;
                            child = second;
                        }
                        else if (StrictlyContains(second, first, config.StationTolerance))
                        {
                            parent = second;
                            child = first;
                        }
                        else
                        {
                            parent = null;
                            child = null;
                        }
                        if (parent != null)
                        {
                            AddRelation(
                                "nested_contains",
                                parent,
                                child,
                                double.NaN,
                                ref relationNumber,
                                output,
                                topologySet,
                                edgeIndexes,
                                "child_interval_is_inside_parent_interval");
                        }
                    }
                }
            }
        }

        static void AddRelation(
            string type,
            DimensionEdgeRecord first,
            DimensionEdgeRecord second,
            double station,
            ref int relationNumber,
            IList<DimensionRelationRecord> output,
            DisjointSet topologySet,
            IDictionary<string, int> edgeIndexes,
            string evidence)
        {
            relationNumber++;
            var relation = new DimensionRelationRecord(
                "dimension-relation-" + relationNumber.ToString(CultureInfo.InvariantCulture),
                type,
                first.Handle,
                second.Handle,
                station);
            relation.AddEvidence("same_owner_coordinate_space");
            relation.AddEvidence("parallel_dimension_axes");
            relation.AddEvidence("normal_contexts_overlap_or_are_near");
            relation.AddEvidence(evidence);
            output.Add(relation);
            topologySet.Union(edgeIndexes[first.Handle], edgeIndexes[second.Handle]);
        }

        static void BuildTopologyGroups(
            IList<DimensionEdgeRecord> edges,
            IList<DimensionRelationRecord> relations,
            DisjointSet set,
            IDictionary<string, int> edgeIndexes,
            DimensionTopologyConfig config,
            out List<DimensionTopologyGroupRecord> groups,
            out List<DimensionNodeRecord> nodes,
            out List<string> isolated)
        {
            var components = new Dictionary<int, List<DimensionEdgeRecord>>();
            for (int index = 0; index < edges.Count; index++)
            {
                int root = set.Find(index);
                List<DimensionEdgeRecord> list;
                if (!components.TryGetValue(root, out list))
                {
                    list = new List<DimensionEdgeRecord>();
                    components[root] = list;
                }
                list.Add(edges[index]);
            }
            var componentLists = new List<List<DimensionEdgeRecord>>(components.Values);
            componentLists.Sort(delegate(
                List<DimensionEdgeRecord> left,
                List<DimensionEdgeRecord> right)
            {
                return string.CompareOrdinal(left[0].Handle, right[0].Handle);
            });
            groups = new List<DimensionTopologyGroupRecord>();
            nodes = new List<DimensionNodeRecord>();
            isolated = new List<string>();
            int nodeNumber = 0;
            foreach (List<DimensionEdgeRecord> component in componentLists)
            {
                string groupId = "dimension-topology-group-"
                    + (groups.Count + 1).ToString(CultureInfo.InvariantCulture);
                var group = new DimensionTopologyGroupRecord(groupId);
                groups.Add(group);
                foreach (DimensionEdgeRecord edge in component)
                {
                    edge.TopologyGroupId = groupId;
                    group.AddEdge(edge.Handle);
                }
                if (component.Count == 1)
                {
                    isolated.Add(component[0].Handle);
                }

                var componentNodes = new List<DimensionNodeRecord>();
                foreach (DimensionEdgeRecord edge in component)
                {
                    DimensionNodeRecord start = FindOrCreateNode(
                        componentNodes,
                        groupId,
                        edge.StartStation,
                        config.StationTolerance,
                        ref nodeNumber);
                    DimensionNodeRecord end = FindOrCreateNode(
                        componentNodes,
                        groupId,
                        edge.EndStation,
                        config.StationTolerance,
                        ref nodeNumber);
                    edge.StartNodeId = start.Id;
                    edge.EndNodeId = end.Id;
                    start.AddEdge(edge.Handle);
                    end.AddEdge(edge.Handle);
                }
                componentNodes.Sort(delegate(DimensionNodeRecord left, DimensionNodeRecord right)
                {
                    return left.Station.CompareTo(right.Station);
                });
                foreach (DimensionNodeRecord node in componentNodes)
                {
                    nodes.Add(node);
                    group.AddNode(node.Id);
                }
                foreach (DimensionRelationRecord relation in relations)
                {
                    int firstIndex;
                    if (edgeIndexes.TryGetValue(relation.FirstHandle, out firstIndex)
                        && edges[firstIndex].TopologyGroupId == groupId)
                    {
                        group.AddRelation(relation.Id);
                    }
                }
            }
        }

        static DimensionNodeRecord FindOrCreateNode(
            IList<DimensionNodeRecord> nodes,
            string groupId,
            double station,
            double tolerance,
            ref int nodeNumber)
        {
            foreach (DimensionNodeRecord node in nodes)
            {
                if (Math.Abs(node.Station - station) <= tolerance)
                {
                    node.Station = (node.Station + station) / 2.0;
                    return node;
                }
            }
            nodeNumber++;
            var created = new DimensionNodeRecord(
                "dimension-node-" + nodeNumber.ToString(CultureInfo.InvariantCulture),
                groupId,
                station);
            nodes.Add(created);
            return created;
        }

        static List<DimensionChainRecord> BuildChains(
            IList<DimensionEdgeRecord> edges,
            IList<DimensionRelationRecord> relations,
            IDictionary<string, int> edgeIndexes)
        {
            var strictSet = new DisjointSet(edges.Count);
            var involved = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (DimensionRelationRecord relation in relations)
            {
                if (!string.Equals(
                    relation.RelationType,
                    "continuous_chain",
                    StringComparison.Ordinal))
                {
                    continue;
                }
                strictSet.Union(
                    edgeIndexes[relation.FirstHandle],
                    edgeIndexes[relation.SecondHandle]);
                involved.Add(relation.FirstHandle);
                involved.Add(relation.SecondHandle);
            }
            var components = new Dictionary<int, List<DimensionEdgeRecord>>();
            foreach (DimensionEdgeRecord edge in edges)
            {
                if (!involved.Contains(edge.Handle))
                {
                    continue;
                }
                int root = strictSet.Find(edgeIndexes[edge.Handle]);
                List<DimensionEdgeRecord> list;
                if (!components.TryGetValue(root, out list))
                {
                    list = new List<DimensionEdgeRecord>();
                    components[root] = list;
                }
                list.Add(edge);
            }
            var values = new List<List<DimensionEdgeRecord>>(components.Values);
            values.Sort(delegate(List<DimensionEdgeRecord> left, List<DimensionEdgeRecord> right)
            {
                double leftStation = MinimumStation(left);
                double rightStation = MinimumStation(right);
                int station = leftStation.CompareTo(rightStation);
                return station != 0
                    ? station
                    : string.CompareOrdinal(left[0].Handle, right[0].Handle);
            });
            var chains = new List<DimensionChainRecord>();
            foreach (List<DimensionEdgeRecord> component in values)
            {
                component.Sort(delegate(DimensionEdgeRecord left, DimensionEdgeRecord right)
                {
                    int station = left.StartStation.CompareTo(right.StartStation);
                    return station != 0
                        ? station
                        : left.EndStation.CompareTo(right.EndStation);
                });
                var nodeIds = new List<string>();
                foreach (DimensionEdgeRecord edge in component)
                {
                    if (!nodeIds.Contains(edge.StartNodeId)) { nodeIds.Add(edge.StartNodeId); }
                    if (!nodeIds.Contains(edge.EndNodeId)) { nodeIds.Add(edge.EndNodeId); }
                }
                var chain = new DimensionChainRecord(
                    "dimension-chain-" + (chains.Count + 1).ToString(CultureInfo.InvariantCulture),
                    component[0].TopologyGroupId,
                    component,
                    nodeIds);
                chains.Add(chain);
                foreach (DimensionEdgeRecord edge in component)
                {
                    edge.AddChain(chain.Id);
                }
            }
            return chains;
        }

        static List<DimensionEquationRecord> BuildPartitionEquations(
            IList<DimensionEdgeRecord> edges,
            DimensionTopologyConfig config)
        {
            var equations = new List<DimensionEquationRecord>();
            var keys = new HashSet<string>(StringComparer.Ordinal);
            foreach (DimensionEdgeRecord parent in edges)
            {
                if (!parent.HasMeasurement)
                {
                    continue;
                }
                for (int firstIndex = 0; firstIndex < edges.Count; firstIndex++)
                {
                    DimensionEdgeRecord first = edges[firstIndex];
                    if (first == parent || !first.HasMeasurement
                        || first.AxisGroupId != parent.AxisGroupId)
                    {
                        continue;
                    }
                    for (int secondIndex = firstIndex + 1;
                        secondIndex < edges.Count;
                        secondIndex++)
                    {
                        DimensionEdgeRecord second = edges[secondIndex];
                        if (second == parent || !second.HasMeasurement
                            || second.AxisGroupId != parent.AxisGroupId)
                        {
                            continue;
                        }
                        if (!IntervalsPartition(parent, first, second, config.StationTolerance)
                            || !NormalClose(parent, first, config)
                            || !NormalClose(parent, second, config))
                        {
                            continue;
                        }
                        string[] childHandles = { first.Handle, second.Handle };
                        Array.Sort(childHandles, StringComparer.Ordinal);
                        string key = parent.Handle + "=" + childHandles[0] + "+" + childHandles[1];
                        if (!keys.Add(key))
                        {
                            continue;
                        }
                        double sum = first.Measurement + second.Measurement;
                        var handles = new[] { parent.Handle, first.Handle, second.Handle };
                        var equation = new DimensionEquationRecord(
                            "dimension-equation-" + (equations.Count + 1).ToString(
                                CultureInfo.InvariantCulture),
                            "explicit_parent_partition",
                            FormatTerm(parent),
                            FormatTerm(first) + " + " + FormatTerm(second),
                            parent.Measurement,
                            sum,
                            handles,
                            WithinEquationTolerance(parent.Measurement, sum, config));
                        equation.AddEvidence("parent_interval_equals_union_of_two_child_intervals");
                        equation.AddEvidence("all_values_are_drawn_dimension_measurements");
                        equations.Add(equation);
                    }
                }
            }
            return equations;
        }

        static List<DimensionDatumProfileRecord> BuildDatumProfiles(
            IList<DimensionEdgeRecord> edges,
            IList<DimensionNodeRecord> nodes,
            IList<DimensionReferenceAxisObservation> referenceAxes,
            DimensionTopologyConfig config,
            IList<DimensionEquationRecord> equations,
            IList<DerivedDimensionRecord> derived)
        {
            var edgeByHandle = new Dictionary<string, DimensionEdgeRecord>(
                StringComparer.OrdinalIgnoreCase);
            foreach (DimensionEdgeRecord edge in edges)
            {
                edgeByHandle[edge.Handle] = edge;
            }
            var profiles = new List<DimensionDatumProfileRecord>();
            foreach (DimensionNodeRecord node in nodes)
            {
                var left = new List<DimensionEdgeRecord>();
                var right = new List<DimensionEdgeRecord>();
                foreach (string handle in node.IncidentEdgeHandles)
                {
                    DimensionEdgeRecord edge = edgeByHandle[handle];
                    if (edge.StartNodeId == node.Id
                        && edge.EndStation > node.Station + config.StationTolerance)
                    {
                        right.Add(edge);
                    }
                    else if (edge.EndNodeId == node.Id
                        && edge.StartStation < node.Station - config.StationTolerance)
                    {
                        left.Add(edge);
                    }
                }
                if (left.Count == 0 || right.Count == 0)
                {
                    continue;
                }
                List<PairMatch> matches = MatchDatumPairs(left, right, config);
                if (matches.Count == 0)
                {
                    continue;
                }
                DimensionEdgeRecord sample = matches[0].Left;
                DimensionReferenceAxisObservation reference = FindReferenceAxis(
                    sample,
                    node.Station,
                    matches,
                    referenceAxes,
                    config);
                var profile = new DimensionDatumProfileRecord(
                    "dimension-datum-profile-" + (profiles.Count + 1).ToString(
                        CultureInfo.InvariantCulture),
                    node.TopologyGroupId,
                    sample.OwnerScope,
                    sample.OwnerBlockName,
                    node.Station,
                    sample.AxisX,
                    sample.AxisY,
                    reference);
                profile.AddEvidence("opposite_side_dimensions_share_endpoint_station");
                profile.AddEvidence("left_and_right_dimensions_are_paired_by_lane");
                if (reference != null)
                {
                    profile.AddEvidence("datum_station_matches_named_perpendicular_axis");
                }
                foreach (PairMatch match in matches)
                {
                    DimensionEdgeRecord explicitSpan = FindExplicitSpan(
                        edges,
                        match.Left.StartStation,
                        match.Right.EndStation,
                        sample.AxisGroupId,
                        config.StationTolerance);
                    var pair = new DimensionDatumPairRecord(
                        profile.Id + ":pair-" + (profile.Pairs.Count + 1).ToString(
                            CultureInfo.InvariantCulture),
                        match.Left,
                        match.Right,
                        node.Station,
                        explicitSpan);
                    profile.AddPair(pair);
                }
                profile.SortPairsByTotalSpan();
                BuildProfileDerivations(profile, edgeByHandle, config, equations, derived);
                SetConstantMidpointOffset(profile, config);
                profiles.Add(profile);
            }
            return profiles;
        }

        static List<PairMatch> MatchDatumPairs(
            IList<DimensionEdgeRecord> left,
            IList<DimensionEdgeRecord> right,
            DimensionTopologyConfig config)
        {
            var candidates = new List<PairMatch>();
            foreach (DimensionEdgeRecord leftEdge in left)
            {
                foreach (DimensionEdgeRecord rightEdge in right)
                {
                    if (leftEdge.AxisGroupId != rightEdge.AxisGroupId
                        || !NormalClose(leftEdge, rightEdge, config))
                    {
                        continue;
                    }
                    double difference = Math.Abs(leftEdge.Lane - rightEdge.Lane);
                    if (difference > config.DatumPairLaneTolerance)
                    {
                        continue;
                    }
                    candidates.Add(new PairMatch
                    {
                        Left = leftEdge,
                        Right = rightEdge,
                        LaneDifference = difference
                    });
                }
            }
            candidates.Sort(delegate(PairMatch first, PairMatch second)
            {
                int lane = first.LaneDifference.CompareTo(second.LaneDifference);
                if (lane != 0) { return lane; }
                return first.Left.GeometricSpan.CompareTo(second.Left.GeometricSpan);
            });
            var usedLeft = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var usedRight = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var result = new List<PairMatch>();
            foreach (PairMatch candidate in candidates)
            {
                if (usedLeft.Contains(candidate.Left.Handle)
                    || usedRight.Contains(candidate.Right.Handle))
                {
                    continue;
                }
                usedLeft.Add(candidate.Left.Handle);
                usedRight.Add(candidate.Right.Handle);
                result.Add(candidate);
            }
            return result;
        }

        static DimensionReferenceAxisObservation FindReferenceAxis(
            DimensionEdgeRecord sample,
            double datumStation,
            IList<PairMatch> matches,
            IList<DimensionReferenceAxisObservation> axes,
            DimensionTopologyConfig config)
        {
            if (axes == null)
            {
                return null;
            }
            DimensionReferenceAxisObservation best = null;
            double bestScore = double.PositiveInfinity;
            foreach (DimensionReferenceAxisObservation axis in axes)
            {
                if (axis == null
                    || !string.Equals(axis.OwnerScope, sample.OwnerScope, StringComparison.Ordinal)
                    || !string.Equals(
                        axis.OwnerBlockName,
                        sample.OwnerBlockName,
                        StringComparison.Ordinal))
                {
                    continue;
                }
                double dx = axis.EndX - axis.StartX;
                double dy = axis.EndY - axis.StartY;
                double length = Math.Sqrt(dx * dx + dy * dy);
                if (length <= 0)
                {
                    continue;
                }
                dx /= length;
                dy /= length;
                double perpendicularError = Math.Abs(dx * sample.AxisX + dy * sample.AxisY);
                double allowed = Math.Sin(
                    config.ReferenceAxisAngleToleranceDegrees * Math.PI / 180.0);
                if (perpendicularError > allowed)
                {
                    continue;
                }
                double station = Dot(axis.StartX, axis.StartY, sample.AxisX, sample.AxisY);
                double stationError = Math.Abs(station - datumStation);
                if (stationError > config.ReferenceAxisStationTolerance)
                {
                    continue;
                }
                double normalStart = Dot(axis.StartX, axis.StartY, sample.NormalX, sample.NormalY);
                double normalEnd = Dot(axis.EndX, axis.EndY, sample.NormalX, sample.NormalY);
                double axisMin = Math.Min(normalStart, normalEnd);
                double axisMax = Math.Max(normalStart, normalEnd);
                double contextMin = double.PositiveInfinity;
                double contextMax = double.NegativeInfinity;
                foreach (PairMatch match in matches)
                {
                    contextMin = Math.Min(
                        contextMin,
                        Math.Min(match.Left.NormalMin, match.Right.NormalMin));
                    contextMax = Math.Max(
                        contextMax,
                        Math.Max(match.Left.NormalMax, match.Right.NormalMax));
                }
                double gap = IntervalGap(axisMin, axisMax, contextMin, contextMax);
                double scale = Math.Max(1.0, contextMax - contextMin);
                if (gap > scale * 0.5)
                {
                    continue;
                }
                double score = stationError + gap;
                if (score < bestScore)
                {
                    best = axis;
                    bestScore = score;
                }
            }
            return best;
        }

        static void BuildProfileDerivations(
            DimensionDatumProfileRecord profile,
            IDictionary<string, DimensionEdgeRecord> edgeByHandle,
            DimensionTopologyConfig config,
            IList<DimensionEquationRecord> equations,
            IList<DerivedDimensionRecord> derived)
        {
            for (int index = 0; index < profile.Pairs.Count; index++)
            {
                DimensionDatumPairRecord pair = profile.Pairs[index];
                var sourceHandles = new[] { pair.LeftHandle, pair.RightHandle };
                derived.Add(new DerivedDimensionRecord(
                    "derived-dimension-" + (derived.Count + 1).ToString(
                        CultureInfo.InvariantCulture),
                    "opposite_offsets_envelope",
                    pair.EnvelopeStartStation,
                    pair.EnvelopeEndStation,
                    pair.TotalSpan,
                    sourceHandles,
                    pair.ExplicitSpanHandle,
                    pair.HasExplicitSpanResidual
                        ? (double?)pair.ExplicitSpanResidual
                        : null));

                if (index == 0)
                {
                    continue;
                }
                DimensionDatumPairRecord inner = profile.Pairs[index - 1];
                var increment = new DimensionLayerIncrementRecord(
                    profile.Id + ":increment-" + index.ToString(CultureInfo.InvariantCulture),
                    inner,
                    pair);
                profile.AddIncrement(increment);
                derived.Add(new DerivedDimensionRecord(
                    "derived-dimension-" + (derived.Count + 1).ToString(
                        CultureInfo.InvariantCulture),
                    "same_datum_consecutive_difference_left",
                    pair.EnvelopeStartStation,
                    inner.EnvelopeStartStation,
                    increment.LeftIncrement,
                    new[] { inner.LeftHandle, pair.LeftHandle },
                    "",
                    null));
                derived.Add(new DerivedDimensionRecord(
                    "derived-dimension-" + (derived.Count + 1).ToString(
                        CultureInfo.InvariantCulture),
                    "same_datum_consecutive_difference_right",
                    inner.EnvelopeEndStation,
                    pair.EnvelopeEndStation,
                    increment.RightIncrement,
                    new[] { inner.RightHandle, pair.RightHandle },
                    "",
                    null));
                var equation = new DimensionEquationRecord(
                    "dimension-equation-" + (equations.Count + 1).ToString(
                        CultureInfo.InvariantCulture),
                    "paired_layer_increment_equality",
                    "left layer increment",
                    "right layer increment",
                    increment.LeftIncrement,
                    increment.RightIncrement,
                    increment.Handles(),
                    WithinEquationTolerance(
                        increment.LeftIncrement,
                        increment.RightIncrement,
                        config));
                equation.AddEvidence("consecutive_left_and_right_datum_offsets");
                equations.Add(equation);
            }
        }

        static void SetConstantMidpointOffset(
            DimensionDatumProfileRecord profile,
            DimensionTopologyConfig config)
        {
            if (profile.Pairs.Count < 2)
            {
                return;
            }
            double sum = 0;
            foreach (DimensionDatumPairRecord pair in profile.Pairs)
            {
                sum += pair.MidpointOffset;
            }
            double average = sum / profile.Pairs.Count;
            foreach (DimensionDatumPairRecord pair in profile.Pairs)
            {
                if (Math.Abs(pair.MidpointOffset - average) > config.EquationAbsoluteTolerance)
                {
                    return;
                }
            }
            profile.HasConstantMidpointOffset = true;
            profile.ConstantMidpointOffset = average;
            profile.AddEvidence("all_paired_envelopes_share_midpoint_offset");
        }

        static DimensionEdgeRecord FindExplicitSpan(
            IList<DimensionEdgeRecord> edges,
            double start,
            double end,
            string axisGroupId,
            double tolerance)
        {
            foreach (DimensionEdgeRecord edge in edges)
            {
                if (edge.AxisGroupId == axisGroupId
                    && Math.Abs(edge.StartStation - start) <= tolerance
                    && Math.Abs(edge.EndStation - end) <= tolerance)
                {
                    return edge;
                }
            }
            return null;
        }

        static bool NormalClose(
            DimensionEdgeRecord first,
            DimensionEdgeRecord second,
            DimensionTopologyConfig config)
        {
            double gap = IntervalGap(
                first.NormalMin,
                first.NormalMax,
                second.NormalMin,
                second.NormalMax);
            double scale = Math.Min(first.GeometricSpan, second.GeometricSpan);
            return gap <= Math.Max(
                config.NormalTolerance,
                scale * config.NormalGapSpanFactor);
        }

        static double IntervalGap(double minA, double maxA, double minB, double maxB)
        {
            if (maxA < minB) { return minB - maxA; }
            if (maxB < minA) { return minA - maxB; }
            return 0;
        }

        static int SharedEndpointCount(
            DimensionEdgeRecord first,
            DimensionEdgeRecord second,
            double tolerance,
            out double shared)
        {
            var matches = new List<double>();
            AddStationMatch(first.StartStation, second.StartStation, tolerance, matches);
            AddStationMatch(first.StartStation, second.EndStation, tolerance, matches);
            AddStationMatch(first.EndStation, second.StartStation, tolerance, matches);
            AddStationMatch(first.EndStation, second.EndStation, tolerance, matches);
            shared = matches.Count == 0 ? double.NaN : matches[0];
            return matches.Count;
        }

        static void AddStationMatch(
            double first,
            double second,
            double tolerance,
            IList<double> matches)
        {
            if (Math.Abs(first - second) > tolerance)
            {
                return;
            }
            double value = (first + second) / 2.0;
            foreach (double existing in matches)
            {
                if (Math.Abs(existing - value) <= tolerance)
                {
                    return;
                }
            }
            matches.Add(value);
        }

        static double OtherStation(
            DimensionEdgeRecord edge,
            double shared,
            double tolerance)
        {
            return Math.Abs(edge.StartStation - shared) <= tolerance
                ? edge.EndStation
                : edge.StartStation;
        }

        static bool StrictlyContains(
            DimensionEdgeRecord outer,
            DimensionEdgeRecord inner,
            double tolerance)
        {
            bool contains = outer.StartStation <= inner.StartStation + tolerance
                && outer.EndStation >= inner.EndStation - tolerance;
            bool strict = outer.StartStation < inner.StartStation - tolerance
                || outer.EndStation > inner.EndStation + tolerance;
            return contains && strict;
        }

        static bool IntervalsPartition(
            DimensionEdgeRecord parent,
            DimensionEdgeRecord first,
            DimensionEdgeRecord second,
            double tolerance)
        {
            DimensionEdgeRecord left = first.StartStation <= second.StartStation
                ? first
                : second;
            DimensionEdgeRecord right = left == first ? second : first;
            return Math.Abs(left.StartStation - parent.StartStation) <= tolerance
                && Math.Abs(right.EndStation - parent.EndStation) <= tolerance
                && Math.Abs(left.EndStation - right.StartStation) <= tolerance;
        }

        static bool WithinEquationTolerance(
            double left,
            double right,
            DimensionTopologyConfig config)
        {
            double tolerance = Math.Max(
                config.EquationAbsoluteTolerance,
                Math.Max(Math.Abs(left), Math.Abs(right))
                    * config.EquationRelativeTolerance);
            return Math.Abs(left - right) <= tolerance;
        }

        static bool SameOwner(DimensionEdgeRecord edge, AxisGroup group)
        {
            return string.Equals(edge.OwnerScope, group.OwnerScope, StringComparison.Ordinal)
                && string.Equals(
                    edge.OwnerBlockName,
                    group.OwnerBlockName,
                    StringComparison.Ordinal);
        }

        static bool IsLinearType(string type)
        {
            return string.Equals(type, "RotatedDimension", StringComparison.Ordinal)
                || string.Equals(type, "AlignedDimension", StringComparison.Ordinal);
        }

        static double NormalizeAxisAngle(double value)
        {
            value %= Math.PI;
            if (value < 0) { value += Math.PI; }
            return value;
        }

        static double AxisDifferenceDegrees(
            double firstX,
            double firstY,
            double secondX,
            double secondY)
        {
            double dot = Math.Abs(firstX * secondX + firstY * secondY);
            dot = Math.Max(-1.0, Math.Min(1.0, dot));
            return Math.Acos(dot) * 180.0 / Math.PI;
        }

        static double Dot(double x, double y, double ux, double uy)
        {
            return x * ux + y * uy;
        }

        static double MinimumStation(IList<DimensionEdgeRecord> edges)
        {
            double result = double.PositiveInfinity;
            foreach (DimensionEdgeRecord edge in edges)
            {
                result = Math.Min(result, edge.StartStation);
            }
            return result;
        }

        static string FormatTerm(DimensionEdgeRecord edge)
        {
            double value = edge.HasMeasurement ? edge.Measurement : edge.GeometricSpan;
            return value.ToString("0.######", CultureInfo.InvariantCulture)
                + "[" + edge.Handle + "]";
        }
    }

    internal static class DimensionTopologyMaps
    {
        internal static Dictionary<string, object> Map(params object[] pairs)
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
