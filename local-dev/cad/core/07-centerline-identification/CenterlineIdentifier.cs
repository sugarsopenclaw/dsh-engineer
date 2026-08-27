using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Shb.Cad.Core
{
    public sealed class CenterlinePointObservation
    {
        public CenterlinePointObservation(double x, double y)
        {
            X = x;
            Y = y;
        }

        public double X { get; private set; }
        public double Y { get; private set; }
    }

    public sealed class CenterlineVertexObservation
    {
        public CenterlineVertexObservation(double x, double y, double bulge)
        {
            X = x;
            Y = y;
            Bulge = bulge;
        }

        public double X { get; private set; }
        public double Y { get; private set; }
        public double Bulge { get; private set; }
    }

    public sealed class CenterlineLayerObservation
    {
        public CenterlineLayerObservation(string name, string handle, string linetype)
        {
            Name = name ?? "";
            Handle = handle ?? "";
            Linetype = linetype ?? "";
        }

        public string Name { get; private set; }
        public string Handle { get; private set; }
        public string Linetype { get; private set; }
    }

    public sealed class CenterlinePrimitiveObservation
    {
        CenterlinePrimitiveObservation(
            string handle,
            string layer,
            string entityLinetype,
            string ownerScope,
            string ownerBlockName,
            string geometryKind)
        {
            Handle = handle ?? "";
            Layer = layer ?? "";
            EntityLinetype = entityLinetype ?? "";
            OwnerScope = ownerScope ?? "";
            OwnerBlockName = ownerBlockName ?? "";
            GeometryKind = geometryKind ?? "";
            Vertices = new List<CenterlineVertexObservation>();
            ControlPoints = new List<CenterlinePointObservation>();
        }

        public string Handle { get; private set; }
        public string Layer { get; private set; }
        public string EntityLinetype { get; private set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public string GeometryKind { get; private set; }
        public double StartX { get; private set; }
        public double StartY { get; private set; }
        public double EndX { get; private set; }
        public double EndY { get; private set; }
        public double CenterX { get; private set; }
        public double CenterY { get; private set; }
        public double Radius { get; private set; }
        public double StartAngleRadians { get; private set; }
        public double EndAngleRadians { get; private set; }
        public bool Closed { get; private set; }
        public IList<CenterlineVertexObservation> Vertices { get; private set; }
        public IList<CenterlinePointObservation> ControlPoints { get; private set; }

        public static CenterlinePrimitiveObservation CreateLine(
            string handle,
            string layer,
            string entityLinetype,
            string ownerScope,
            string ownerBlockName,
            double startX,
            double startY,
            double endX,
            double endY)
        {
            var result = new CenterlinePrimitiveObservation(
                handle,
                layer,
                entityLinetype,
                ownerScope,
                ownerBlockName,
                "line");
            result.StartX = startX;
            result.StartY = startY;
            result.EndX = endX;
            result.EndY = endY;
            return result;
        }

        public static CenterlinePrimitiveObservation CreateArc(
            string handle,
            string layer,
            string entityLinetype,
            string ownerScope,
            string ownerBlockName,
            double centerX,
            double centerY,
            double radius,
            double startAngleRadians,
            double endAngleRadians)
        {
            var result = new CenterlinePrimitiveObservation(
                handle,
                layer,
                entityLinetype,
                ownerScope,
                ownerBlockName,
                "arc");
            result.CenterX = centerX;
            result.CenterY = centerY;
            result.Radius = radius;
            result.StartAngleRadians = startAngleRadians;
            result.EndAngleRadians = endAngleRadians;
            return result;
        }

        public static CenterlinePrimitiveObservation CreateCircle(
            string handle,
            string layer,
            string entityLinetype,
            string ownerScope,
            string ownerBlockName,
            double centerX,
            double centerY,
            double radius)
        {
            var result = new CenterlinePrimitiveObservation(
                handle,
                layer,
                entityLinetype,
                ownerScope,
                ownerBlockName,
                "circle");
            result.CenterX = centerX;
            result.CenterY = centerY;
            result.Radius = radius;
            result.Closed = true;
            return result;
        }

        public static CenterlinePrimitiveObservation CreatePolyline(
            string handle,
            string layer,
            string entityLinetype,
            string ownerScope,
            string ownerBlockName,
            bool closed,
            IList<CenterlineVertexObservation> vertices)
        {
            var result = new CenterlinePrimitiveObservation(
                handle,
                layer,
                entityLinetype,
                ownerScope,
                ownerBlockName,
                "polyline");
            result.Closed = closed;
            if (vertices != null)
            {
                foreach (CenterlineVertexObservation vertex in vertices)
                {
                    if (vertex != null)
                    {
                        result.Vertices.Add(vertex);
                    }
                }
            }
            return result;
        }

        public static CenterlinePrimitiveObservation CreateSpline(
            string handle,
            string layer,
            string entityLinetype,
            string ownerScope,
            string ownerBlockName,
            bool closed,
            IList<CenterlinePointObservation> controlPoints)
        {
            var result = new CenterlinePrimitiveObservation(
                handle,
                layer,
                entityLinetype,
                ownerScope,
                ownerBlockName,
                "spline");
            result.Closed = closed;
            if (controlPoints != null)
            {
                foreach (CenterlinePointObservation point in controlPoints)
                {
                    if (point != null)
                    {
                        result.ControlPoints.Add(point);
                    }
                }
            }
            return result;
        }

        public bool IsDegenerate(double tolerance)
        {
            if (string.Equals(GeometryKind, "line", StringComparison.Ordinal))
            {
                return Distance(StartX, StartY, EndX, EndY) <= tolerance;
            }
            if (string.Equals(GeometryKind, "arc", StringComparison.Ordinal))
            {
                return Radius <= tolerance || ArcSweepRadians <= 1e-12;
            }
            if (string.Equals(GeometryKind, "circle", StringComparison.Ordinal))
            {
                return Radius <= tolerance;
            }
            if (string.Equals(GeometryKind, "polyline", StringComparison.Ordinal))
            {
                return Vertices.Count < 2 || ApproximateLength <= tolerance;
            }
            if (string.Equals(GeometryKind, "spline", StringComparison.Ordinal))
            {
                return ControlPoints.Count < 2 || ApproximateLength <= tolerance;
            }
            return true;
        }

        public double ArcSweepRadians
        {
            get
            {
                if (!string.Equals(GeometryKind, "arc", StringComparison.Ordinal))
                {
                    return 0;
                }
                return NormalizePositiveAngle(EndAngleRadians - StartAngleRadians);
            }
        }

        public double ApproximateLength
        {
            get
            {
                if (string.Equals(GeometryKind, "line", StringComparison.Ordinal))
                {
                    return Distance(StartX, StartY, EndX, EndY);
                }
                if (string.Equals(GeometryKind, "arc", StringComparison.Ordinal))
                {
                    return Radius * ArcSweepRadians;
                }
                if (string.Equals(GeometryKind, "circle", StringComparison.Ordinal))
                {
                    return 2.0 * Math.PI * Radius;
                }
                if (string.Equals(GeometryKind, "polyline", StringComparison.Ordinal))
                {
                    double length = 0;
                    int segmentCount = Closed ? Vertices.Count : Vertices.Count - 1;
                    for (int index = 0; index < segmentCount; index++)
                    {
                        CenterlineVertexObservation start = Vertices[index];
                        CenterlineVertexObservation end = Vertices[(index + 1) % Vertices.Count];
                        double chord = Distance(start.X, start.Y, end.X, end.Y);
                        double sweep = Math.Abs(4.0 * Math.Atan(start.Bulge));
                        if (chord <= 1e-12)
                        {
                            continue;
                        }
                        if (sweep <= 1e-12)
                        {
                            length += chord;
                        }
                        else
                        {
                            double radius = chord / (2.0 * Math.Sin(sweep * 0.5));
                            length += Math.Abs(radius * sweep);
                        }
                    }
                    return length;
                }
                if (string.Equals(GeometryKind, "spline", StringComparison.Ordinal))
                {
                    double length = 0;
                    for (int index = 1; index < ControlPoints.Count; index++)
                    {
                        length += Distance(
                            ControlPoints[index - 1].X,
                            ControlPoints[index - 1].Y,
                            ControlPoints[index].X,
                            ControlPoints[index].Y);
                    }
                    if (Closed && ControlPoints.Count > 2)
                    {
                        length += Distance(
                            ControlPoints[ControlPoints.Count - 1].X,
                            ControlPoints[ControlPoints.Count - 1].Y,
                            ControlPoints[0].X,
                            ControlPoints[0].Y);
                    }
                    return length;
                }
                return 0;
            }
        }

        internal Dictionary<string, object> GeometryMap()
        {
            if (string.Equals(GeometryKind, "line", StringComparison.Ordinal))
            {
                return CenterlineMaps.Map(
                    "kind", "line",
                    "start", new[] { StartX, StartY },
                    "end", new[] { EndX, EndY });
            }
            if (string.Equals(GeometryKind, "arc", StringComparison.Ordinal))
            {
                return CenterlineMaps.Map(
                    "kind", "arc",
                    "center", new[] { CenterX, CenterY },
                    "radius", Radius,
                    "start_angle_degrees", Degrees(StartAngleRadians),
                    "end_angle_degrees", Degrees(EndAngleRadians),
                    "sweep_degrees", Degrees(ArcSweepRadians));
            }
            if (string.Equals(GeometryKind, "circle", StringComparison.Ordinal))
            {
                return CenterlineMaps.Map(
                    "kind", "circle",
                    "center", new[] { CenterX, CenterY },
                    "radius", Radius);
            }
            if (string.Equals(GeometryKind, "polyline", StringComparison.Ordinal))
            {
                var vertices = new List<Dictionary<string, object>>();
                foreach (CenterlineVertexObservation vertex in Vertices)
                {
                    vertices.Add(CenterlineMaps.Map(
                        "point", new[] { vertex.X, vertex.Y },
                        "bulge", vertex.Bulge));
                }
                return CenterlineMaps.Map(
                    "kind", "polyline",
                    "closed", Closed,
                    "vertices", vertices);
            }
            var points = new List<double[]>();
            foreach (CenterlinePointObservation point in ControlPoints)
            {
                points.Add(new[] { point.X, point.Y });
            }
            return CenterlineMaps.Map(
                "kind", "spline",
                "closed", Closed,
                "control_points", points,
                "length_is_control_polygon_approximation", true);
        }

        static double Distance(double x1, double y1, double x2, double y2)
        {
            double dx = x2 - x1;
            double dy = y2 - y1;
            return Math.Sqrt(dx * dx + dy * dy);
        }

        static double NormalizePositiveAngle(double value)
        {
            double full = 2.0 * Math.PI;
            value %= full;
            if (value < 0)
            {
                value += full;
            }
            return value;
        }

        static double Degrees(double radians)
        {
            double result = radians * 180.0 / Math.PI;
            result %= 360.0;
            return result < 0 ? result + 360.0 : result;
        }
    }

    public sealed class CenterlineLabelLeaderObservation
    {
        public CenterlineLabelLeaderObservation(
            string handle,
            string ownerScope,
            string ownerBlockName,
            string text,
            double startX,
            double startY,
            double endX,
            double endY)
        {
            Handle = handle ?? "";
            OwnerScope = ownerScope ?? "";
            OwnerBlockName = ownerBlockName ?? "";
            Text = text ?? "";
            StartX = startX;
            StartY = startY;
            EndX = endX;
            EndY = endY;
        }

        public string Handle { get; private set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public string Text { get; private set; }
        public double StartX { get; private set; }
        public double StartY { get; private set; }
        public double EndX { get; private set; }
        public double EndY { get; private set; }
    }

    public sealed class CenterlineIdentificationConfig
    {
        public CenterlineIdentificationConfig()
        {
            CenterlineTextMarker = "中心线";
            CenterLinetypeMarker = "CENTER";
            LeaderTargetTolerance = 1.0;
            GeometryTolerance = 0.01;
            DirectionAxisToleranceDegrees = 0.5;
            TangentToleranceDegrees = 2.0;
        }

        public string CenterlineTextMarker { get; set; }
        public string CenterLinetypeMarker { get; set; }
        public double LeaderTargetTolerance { get; set; }
        public double GeometryTolerance { get; set; }
        public double DirectionAxisToleranceDegrees { get; set; }
        public double TangentToleranceDegrees { get; set; }
    }

    public sealed class CenterlineLabelBinding
    {
        internal CenterlineLabelBinding(
            CenterlineLabelLeaderObservation leader,
            double geometryPointX,
            double geometryPointY,
            double distance)
        {
            LeaderHandle = leader.Handle;
            Text = leader.Text;
            LeaderTargetX = leader.StartX;
            LeaderTargetY = leader.StartY;
            GeometryPointX = geometryPointX;
            GeometryPointY = geometryPointY;
            Distance = distance;
        }

        public string LeaderHandle { get; private set; }
        public string Text { get; private set; }
        public double LeaderTargetX { get; private set; }
        public double LeaderTargetY { get; private set; }
        public double GeometryPointX { get; private set; }
        public double GeometryPointY { get; private set; }
        public double Distance { get; private set; }

        internal Dictionary<string, object> ToMap()
        {
            return CenterlineMaps.Map(
                "leader_handle", LeaderHandle,
                "text", Text,
                "leader_target", new[] { LeaderTargetX, LeaderTargetY },
                "geometry_point", new[] { GeometryPointX, GeometryPointY },
                "distance", Distance);
        }
    }

    public sealed class CenterlineRecord
    {
        double stableStartX;
        double stableStartY;
        double unitX;
        double unitY;

        internal CenterlineRecord(
            CenterlinePrimitiveObservation primitive,
            CenterlineLayerObservation layer,
            double directionAxisToleranceDegrees)
        {
            Primitive = primitive;
            Handle = primitive.Handle;
            Layer = primitive.Layer;
            EntityLinetype = primitive.EntityLinetype;
            LayerLinetype = layer == null ? "" : layer.Linetype;
            EffectiveLinetype = ResolveEffectiveLinetype(EntityLinetype, LayerLinetype);
            OwnerScope = primitive.OwnerScope;
            OwnerBlockName = primitive.OwnerBlockName;
            GeometryKind = primitive.GeometryKind;
            DirectionAxisToleranceDegrees = directionAxisToleranceDegrees;
            StyleMatches = new List<string>();
            LabelBindings = new List<CenterlineLabelBinding>();
            ShapeIds = new List<string>();
            IntersectionIds = new List<string>();
            SetStableLineDirection();
        }

        internal CenterlinePrimitiveObservation Primitive { get; private set; }
        internal double DirectionAxisToleranceDegrees { get; private set; }
        public string Id { get; internal set; }
        public string Handle { get; private set; }
        public string Layer { get; private set; }
        public string EntityLinetype { get; private set; }
        public string LayerLinetype { get; private set; }
        public string EffectiveLinetype { get; private set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public string GeometryKind { get; private set; }
        public bool MatchedByText { get; internal set; }
        public bool MatchedByStyle { get; internal set; }
        public IList<string> StyleMatches { get; private set; }
        public IList<CenterlineLabelBinding> LabelBindings { get; private set; }
        public IList<string> ShapeIds { get; private set; }
        public IList<string> IntersectionIds { get; private set; }
        public double Length { get { return Primitive.ApproximateLength; } }
        public double OrientationDegrees
        {
            get
            {
                if (!IsStraightLine)
                {
                    return double.NaN;
                }
                double degrees = Math.Atan2(unitY, unitX) * 180.0 / Math.PI;
                degrees %= 180.0;
                return degrees < 0 ? degrees + 180.0 : degrees;
            }
        }
        public string DirectionClass
        {
            get
            {
                if (!IsStraightLine)
                {
                    return "";
                }
                double orientation = OrientationDegrees;
                if (orientation <= DirectionAxisToleranceDegrees
                    || 180.0 - orientation <= DirectionAxisToleranceDegrees)
                {
                    return "horizontal";
                }
                if (Math.Abs(orientation - 90.0) <= DirectionAxisToleranceDegrees)
                {
                    return "vertical";
                }
                return "angled";
            }
        }
        public bool IsStraightLine
        {
            get { return string.Equals(GeometryKind, "line", StringComparison.Ordinal); }
        }

        public bool HasLabel(string textMarker)
        {
            if (string.IsNullOrEmpty(textMarker))
            {
                return false;
            }
            foreach (CenterlineLabelBinding binding in LabelBindings)
            {
                if ((binding.Text ?? "").IndexOf(textMarker, StringComparison.Ordinal) >= 0)
                {
                    return true;
                }
            }
            return false;
        }

        public double SignedDistance(double x, double y)
        {
            RequireStraightLine();
            return unitX * (y - stableStartY) - unitY * (x - stableStartX);
        }

        public double[] ReflectPoint(double x, double y)
        {
            RequireStraightLine();
            double projection = (x - stableStartX) * unitX + (y - stableStartY) * unitY;
            double projectedX = stableStartX + projection * unitX;
            double projectedY = stableStartY + projection * unitY;
            return new[] { 2.0 * projectedX - x, 2.0 * projectedY - y };
        }

        public double RadialDistance(double x, double y)
        {
            RequireRadialGeometry();
            double dx = x - Primitive.CenterX;
            double dy = y - Primitive.CenterY;
            return Math.Sqrt(dx * dx + dy * dy) - Primitive.Radius;
        }

        public double PolarAngleDegrees(double x, double y)
        {
            RequireRadialGeometry();
            double result = Math.Atan2(y - Primitive.CenterY, x - Primitive.CenterX)
                * 180.0 / Math.PI;
            return result < 0 ? result + 360.0 : result;
        }

        internal void AddStyleMatch(string value)
        {
            if (!string.IsNullOrEmpty(value) && !ContainsOrdinal(StyleMatches, value))
            {
                StyleMatches.Add(value);
            }
        }

        internal void AddLabelBinding(CenterlineLabelBinding binding)
        {
            if (binding == null)
            {
                return;
            }
            foreach (CenterlineLabelBinding existing in LabelBindings)
            {
                if (string.Equals(
                    existing.LeaderHandle,
                    binding.LeaderHandle,
                    StringComparison.OrdinalIgnoreCase))
                {
                    return;
                }
            }
            LabelBindings.Add(binding);
        }

        internal void AddShapeId(string shapeId)
        {
            AddUnique(ShapeIds, shapeId);
        }

        internal void AddIntersectionId(string intersectionId)
        {
            AddUnique(IntersectionIds, intersectionId);
        }

        internal void Merge(CenterlineRecord other)
        {
            if (other == null)
            {
                return;
            }
            MatchedByText = MatchedByText || other.MatchedByText;
            MatchedByStyle = MatchedByStyle || other.MatchedByStyle;
            foreach (string match in other.StyleMatches)
            {
                AddStyleMatch(match);
            }
            foreach (CenterlineLabelBinding binding in other.LabelBindings)
            {
                AddLabelBinding(binding);
            }
        }

        internal Dictionary<string, object> ToMap()
        {
            var sources = new List<string>();
            if (MatchedByText)
            {
                sources.Add("text_label");
            }
            if (MatchedByStyle)
            {
                sources.Add("geometry_style");
            }
            var labels = new List<Dictionary<string, object>>();
            foreach (CenterlineLabelBinding binding in LabelBindings)
            {
                labels.Add(binding.ToMap());
            }
            var map = CenterlineMaps.Map(
                "id", Id,
                "handle", Handle,
                "owner_scope", OwnerScope,
                "owner_block_name", OwnerBlockName,
                "coordinate_space", SpaceKey(OwnerScope, OwnerBlockName),
                "geometry_kind", GeometryKind,
                "layer", Layer,
                "entity_linetype", EntityLinetype,
                "layer_linetype", LayerLinetype,
                "effective_linetype", EffectiveLinetype,
                "geometry", Primitive.GeometryMap(),
                "length", Length,
                "recognition_sources", sources,
                "style_matches", StyleMatches,
                "label_bindings", labels,
                "shape_ids", ShapeIds,
                "intersection_ids", IntersectionIds);
            if (IsStraightLine)
            {
                map["orientation_degrees"] = OrientationDegrees;
                map["direction_class"] = DirectionClass;
                map["geometry_operations"] = new[] { "signed_distance", "reflect_point" };
            }
            else if (string.Equals(GeometryKind, "circle", StringComparison.Ordinal)
                || string.Equals(GeometryKind, "arc", StringComparison.Ordinal))
            {
                map["geometry_operations"] = new[] { "radial_distance", "polar_angle" };
            }
            else
            {
                map["geometry_operations"] = new[] { "path_length" };
            }
            return map;
        }

        void SetStableLineDirection()
        {
            if (!IsStraightLine)
            {
                unitX = 1;
                unitY = 0;
                return;
            }
            double startX = Primitive.StartX;
            double startY = Primitive.StartY;
            double endX = Primitive.EndX;
            double endY = Primitive.EndY;
            double dx = endX - startX;
            double dy = endY - startY;
            if ((Math.Abs(dx) >= Math.Abs(dy) && dx < 0)
                || (Math.Abs(dy) > Math.Abs(dx) && dy < 0))
            {
                stableStartX = endX;
                stableStartY = endY;
                dx = -dx;
                dy = -dy;
            }
            else
            {
                stableStartX = startX;
                stableStartY = startY;
            }
            double length = Math.Sqrt(dx * dx + dy * dy);
            unitX = length <= 0 ? 1 : dx / length;
            unitY = length <= 0 ? 0 : dy / length;
        }

        void RequireStraightLine()
        {
            if (!IsStraightLine)
            {
                throw new InvalidOperationException("This operation requires a straight centerline.");
            }
        }

        void RequireRadialGeometry()
        {
            if (!string.Equals(GeometryKind, "circle", StringComparison.Ordinal)
                && !string.Equals(GeometryKind, "arc", StringComparison.Ordinal))
            {
                throw new InvalidOperationException("This operation requires a circle or arc.");
            }
        }

        static string ResolveEffectiveLinetype(string entityLinetype, string layerLinetype)
        {
            if (string.IsNullOrWhiteSpace(entityLinetype)
                || string.Equals(entityLinetype, "ByLayer", StringComparison.OrdinalIgnoreCase))
            {
                return layerLinetype ?? "";
            }
            return entityLinetype;
        }

        static bool ContainsOrdinal(IList<string> values, string value)
        {
            foreach (string existing in values)
            {
                if (string.Equals(existing, value, StringComparison.Ordinal))
                {
                    return true;
                }
            }
            return false;
        }

        static void AddUnique(IList<string> values, string value)
        {
            if (!string.IsNullOrEmpty(value) && !ContainsOrdinal(values, value))
            {
                values.Add(value);
            }
        }

        static string SpaceKey(string ownerScope, string ownerBlockName)
        {
            return (ownerScope ?? "") + ":" + (ownerBlockName ?? "");
        }
    }

    public sealed class CenterlineCoordinateSpaceSummary
    {
        internal CenterlineCoordinateSpaceSummary(string ownerScope, string ownerBlockName)
        {
            OwnerScope = ownerScope ?? "";
            OwnerBlockName = ownerBlockName ?? "";
            GeometryKindCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        }

        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public int CenterGeometryCount { get; internal set; }
        public int TextMatchedCount { get; internal set; }
        public int StyleMatchedCount { get; internal set; }
        public int ShapeCount { get; internal set; }
        public int IntersectionCount { get; internal set; }
        public IDictionary<string, int> GeometryKindCounts { get; private set; }

        internal Dictionary<string, object> ToMap()
        {
            return CenterlineMaps.Map(
                "owner_scope", OwnerScope,
                "owner_block_name", OwnerBlockName,
                "center_geometry_count", CenterGeometryCount,
                "text_matched_count", TextMatchedCount,
                "style_matched_count", StyleMatchedCount,
                "shape_count", ShapeCount,
                "intersection_count", IntersectionCount,
                "geometry_kind_counts", GeometryKindCounts);
        }
    }

    public sealed class CenterlineIdentificationDocument
    {
        internal CenterlineIdentificationDocument(string drawingId)
        {
            DrawingId = drawingId ?? "";
            Centerlines = new List<CenterlineRecord>();
            Shapes = new List<CenterlineShapeRecord>();
            Intersections = new List<CenterlineIntersection>();
        }

        public string DrawingId { get; private set; }
        public IList<CenterlineRecord> Centerlines { get; private set; }
        public IList<CenterlineShapeRecord> Shapes { get; private set; }
        public IList<CenterlineIntersection> Intersections { get; private set; }
        public int TextMatchedCount { get { return CountByPath(true, false); } }
        public int StyleMatchedCount { get { return CountByPath(false, true); } }
        public int BothMatchedCount { get { return CountByPath(true, true); } }
        public int HorizontalLineCount { get { return CountDirection("horizontal"); } }
        public int VerticalLineCount { get { return CountDirection("vertical"); } }
        public int AngledLineCount { get { return CountDirection("angled"); } }
        public int ModelSpaceCount { get { return CountScope("model_space"); } }
        public int BlockDefinitionCount { get { return CountScope("block_definition"); } }

        public int GeometryKindCount(string geometryKind)
        {
            int count = 0;
            foreach (CenterlineRecord centerline in Centerlines)
            {
                if (string.Equals(
                    centerline.GeometryKind,
                    geometryKind ?? "",
                    StringComparison.OrdinalIgnoreCase))
                {
                    count++;
                }
            }
            return count;
        }

        public IList<CenterlineRecord> FindByLabel(string textMarker)
        {
            var result = new List<CenterlineRecord>();
            foreach (CenterlineRecord centerline in Centerlines)
            {
                if (centerline.HasLabel(textMarker))
                {
                    result.Add(centerline);
                }
            }
            return result;
        }

        public IList<CenterlineRecord> FindInCoordinateSpace(
            string ownerScope,
            string ownerBlockName)
        {
            var result = new List<CenterlineRecord>();
            foreach (CenterlineRecord centerline in Centerlines)
            {
                if (SameSpace(
                    centerline.OwnerScope,
                    centerline.OwnerBlockName,
                    ownerScope,
                    ownerBlockName))
                {
                    result.Add(centerline);
                }
            }
            return result;
        }

        public IList<CenterlineShapeRecord> FindShapesByType(string shapeType)
        {
            var result = new List<CenterlineShapeRecord>();
            foreach (CenterlineShapeRecord shape in Shapes)
            {
                if (string.Equals(
                    shape.ShapeType,
                    shapeType ?? "",
                    StringComparison.OrdinalIgnoreCase))
                {
                    result.Add(shape);
                }
            }
            return result;
        }

        public IList<CenterlineIntersection> FindIntersectionsNear(
            string ownerScope,
            string ownerBlockName,
            double x,
            double y,
            double radius)
        {
            if (radius < 0)
            {
                throw new ArgumentOutOfRangeException("radius");
            }
            var result = new List<CenterlineIntersection>();
            double radiusSquared = radius * radius;
            foreach (CenterlineIntersection intersection in Intersections)
            {
                if (!SameSpace(
                    intersection.OwnerScope,
                    intersection.OwnerBlockName,
                    ownerScope,
                    ownerBlockName))
                {
                    continue;
                }
                double dx = intersection.X - x;
                double dy = intersection.Y - y;
                if (dx * dx + dy * dy <= radiusSquared)
                {
                    result.Add(intersection);
                }
            }
            return result;
        }

        public IList<CenterlineCoordinateSpaceSummary> CoordinateSpaces()
        {
            var bySpace = new Dictionary<string, CenterlineCoordinateSpaceSummary>(
                StringComparer.OrdinalIgnoreCase);
            foreach (CenterlineRecord centerline in Centerlines)
            {
                CenterlineCoordinateSpaceSummary summary = GetSpaceSummary(
                    bySpace,
                    centerline.OwnerScope,
                    centerline.OwnerBlockName);
                summary.CenterGeometryCount++;
                if (centerline.MatchedByText)
                {
                    summary.TextMatchedCount++;
                }
                if (centerline.MatchedByStyle)
                {
                    summary.StyleMatchedCount++;
                }
                int kindCount;
                summary.GeometryKindCounts.TryGetValue(centerline.GeometryKind, out kindCount);
                summary.GeometryKindCounts[centerline.GeometryKind] = kindCount + 1;
            }
            foreach (CenterlineShapeRecord shape in Shapes)
            {
                GetSpaceSummary(bySpace, shape.OwnerScope, shape.OwnerBlockName).ShapeCount++;
            }
            foreach (CenterlineIntersection intersection in Intersections)
            {
                GetSpaceSummary(
                    bySpace,
                    intersection.OwnerScope,
                    intersection.OwnerBlockName).IntersectionCount++;
            }
            var result = new List<CenterlineCoordinateSpaceSummary>(bySpace.Values);
            result.Sort(CompareSpaces);
            return result;
        }

        public Dictionary<string, object> ToMap()
        {
            var centerlines = new List<Dictionary<string, object>>();
            foreach (CenterlineRecord centerline in Centerlines)
            {
                centerlines.Add(centerline.ToMap());
            }
            var shapes = new List<Dictionary<string, object>>();
            foreach (CenterlineShapeRecord shape in Shapes)
            {
                shapes.Add(shape.ToMap());
            }
            var intersections = new List<Dictionary<string, object>>();
            foreach (CenterlineIntersection intersection in Intersections)
            {
                intersections.Add(intersection.ToMap());
            }
            var spaces = new List<Dictionary<string, object>>();
            foreach (CenterlineCoordinateSpaceSummary space in CoordinateSpaces())
            {
                spaces.Add(space.ToMap());
            }
            return CenterlineMaps.Map(
                "schema_version", "1",
                "analysis_type", "centerline_identification",
                "identifier", "centerline_identifier",
                "identifier_version", "2",
                "drawing_id", DrawingId,
                "center_geometry_count", Centerlines.Count,
                "text_matched_count", TextMatchedCount,
                "style_matched_count", StyleMatchedCount,
                "both_matched_count", BothMatchedCount,
                "geometry_kind_counts", GeometryKindCounts(),
                "straight_direction_counts", CenterlineMaps.Map(
                    "horizontal", HorizontalLineCount,
                    "vertical", VerticalLineCount,
                    "angled", AngledLineCount),
                "model_space_count", ModelSpaceCount,
                "block_definition_count", BlockDefinitionCount,
                "shape_count", Shapes.Count,
                "intersection_count", Intersections.Count,
                "coordinate_spaces", spaces,
                "shapes", shapes,
                "intersections", intersections,
                "center_geometries", centerlines);
        }

        public string ToMarkdown()
        {
            var markdown = new StringBuilder();
            markdown.AppendLine("# 中心线与中心几何识别");
            markdown.AppendLine();
            markdown.Append("图纸：`");
            markdown.Append(EscapeInline(DrawingId));
            markdown.AppendLine("`");
            markdown.AppendLine();
            markdown.Append("- 正查与倒查去重后的中心几何：");
            markdown.Append(Centerlines.Count.ToString(CultureInfo.InvariantCulture));
            markdown.AppendLine(" 个。");
            markdown.Append("- Line ");
            markdown.Append(GeometryKindCount("line").ToString(CultureInfo.InvariantCulture));
            markdown.Append("，Arc ");
            markdown.Append(GeometryKindCount("arc").ToString(CultureInfo.InvariantCulture));
            markdown.Append("，Circle ");
            markdown.Append(GeometryKindCount("circle").ToString(CultureInfo.InvariantCulture));
            markdown.Append("，Polyline ");
            markdown.Append(GeometryKindCount("polyline").ToString(CultureInfo.InvariantCulture));
            markdown.Append("，Spline ");
            markdown.Append(GeometryKindCount("spline").ToString(CultureInfo.InvariantCulture));
            markdown.AppendLine("。");
            markdown.Append("- 直线方向：水平 ");
            markdown.Append(HorizontalLineCount.ToString(CultureInfo.InvariantCulture));
            markdown.Append("，竖直 ");
            markdown.Append(VerticalLineCount.ToString(CultureInfo.InvariantCulture));
            markdown.Append("，带角度 ");
            markdown.Append(AngledLineCount.ToString(CultureInfo.InvariantCulture));
            markdown.AppendLine("。");
            markdown.Append("- 中心形态 ");
            markdown.Append(Shapes.Count.ToString(CultureInfo.InvariantCulture));
            markdown.Append(" 个；中心几何交点 ");
            markdown.Append(Intersections.Count.ToString(CultureInfo.InvariantCulture));
            markdown.AppendLine(" 个。");

            markdown.AppendLine();
            markdown.AppendLine("## 中心形态");
            markdown.AppendLine();
            foreach (CenterlineShapeRecord shape in Shapes)
            {
                markdown.Append("- `");
                markdown.Append(shape.Id);
                markdown.Append("`：`");
                markdown.Append(shape.ShapeType);
                markdown.Append("`");
                if (!string.IsNullOrEmpty(shape.ShapeSubtype))
                {
                    markdown.Append(" / `");
                    markdown.Append(shape.ShapeSubtype);
                    markdown.Append('`');
                }
                markdown.Append("，空间 `");
                markdown.Append(EscapeInline(SpaceKey(shape.OwnerScope, shape.OwnerBlockName)));
                markdown.Append("`，源句柄 `");
                markdown.Append(EscapeInline(JoinInline(shape.PrimitiveHandles)));
                markdown.Append("`，路径长度 ");
                markdown.Append(Format(shape.PathLength));
                markdown.AppendLine("。");
            }

            markdown.AppendLine();
            markdown.AppendLine("## 中心几何交点（视觉锚点）");
            markdown.AppendLine();
            foreach (CenterlineIntersection intersection in Intersections)
            {
                markdown.Append("- `");
                markdown.Append(intersection.Id);
                markdown.Append("`：(");
                markdown.Append(Format(intersection.X));
                markdown.Append(", ");
                markdown.Append(Format(intersection.Y));
                markdown.Append(") @ `");
                markdown.Append(EscapeInline(SpaceKey(
                    intersection.OwnerScope,
                    intersection.OwnerBlockName)));
                markdown.Append("`，`");
                markdown.Append(intersection.IntersectionType);
                markdown.Append("`，参与句柄 `");
                markdown.Append(EscapeInline(JoinInline(intersection.PrimitiveHandles)));
                markdown.Append('`');
                if (intersection.CrossingAnglesDegrees.Count > 0)
                {
                    markdown.Append("，相交角 ");
                    markdown.Append(Format(intersection.CrossingAnglesDegrees[0]));
                    markdown.Append('°');
                }
                markdown.AppendLine("。");
            }

            markdown.AppendLine();
            markdown.AppendLine("## 带文字标注的中心几何");
            markdown.AppendLine();
            bool hasLabeled = false;
            foreach (CenterlineRecord centerline in Centerlines)
            {
                if (!centerline.MatchedByText)
                {
                    continue;
                }
                hasLabeled = true;
                markdown.Append("- `");
                markdown.Append(EscapeInline(centerline.Handle));
                markdown.Append("`（");
                markdown.Append(centerline.GeometryKind);
                markdown.Append("）：");
                AppendLabels(markdown, centerline.LabelBindings);
                markdown.AppendLine("。");
            }
            if (!hasLabeled)
            {
                markdown.AppendLine("- 无文字正查命中。");
            }

            markdown.AppendLine();
            markdown.AppendLine("## 坐标空间汇总");
            markdown.AppendLine();
            foreach (CenterlineCoordinateSpaceSummary space in CoordinateSpaces())
            {
                markdown.Append("- `");
                markdown.Append(EscapeInline(SpaceKey(space.OwnerScope, space.OwnerBlockName)));
                markdown.Append("`：中心几何 ");
                markdown.Append(space.CenterGeometryCount.ToString(CultureInfo.InvariantCulture));
                markdown.Append("，形态 ");
                markdown.Append(space.ShapeCount.ToString(CultureInfo.InvariantCulture));
                markdown.Append("，交点 ");
                markdown.Append(space.IntersectionCount.ToString(CultureInfo.InvariantCulture));
                markdown.AppendLine("。");
            }

            markdown.AppendLine();
            markdown.AppendLine("## 全部中心几何图元");
            markdown.AppendLine();
            foreach (CenterlineRecord centerline in Centerlines)
            {
                markdown.Append("- `");
                markdown.Append(EscapeInline(centerline.Handle));
                markdown.Append("` @ `");
                markdown.Append(EscapeInline(SpaceKey(
                    centerline.OwnerScope,
                    centerline.OwnerBlockName)));
                markdown.Append("`：");
                markdown.Append(centerline.GeometryKind);
                if (centerline.IsStraightLine)
                {
                    markdown.Append("，角度 ");
                    markdown.Append(Format(centerline.OrientationDegrees));
                    markdown.Append("°（");
                    markdown.Append(centerline.DirectionClass);
                    markdown.Append(')');
                }
                markdown.Append("，层 `");
                markdown.Append(EscapeInline(centerline.Layer));
                markdown.Append("`，线型 `");
                markdown.Append(EscapeInline(centerline.EffectiveLinetype));
                markdown.Append("`，形态 `");
                markdown.Append(EscapeInline(JoinInline(centerline.ShapeIds)));
                markdown.Append("`，交点 ");
                markdown.Append(centerline.IntersectionIds.Count.ToString(CultureInfo.InvariantCulture));
                markdown.AppendLine("。");
            }
            return markdown.ToString();
        }

        Dictionary<string, int> GeometryKindCounts()
        {
            var result = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (CenterlineRecord centerline in Centerlines)
            {
                int count;
                result.TryGetValue(centerline.GeometryKind, out count);
                result[centerline.GeometryKind] = count + 1;
            }
            return result;
        }

        int CountByPath(bool requireText, bool requireStyle)
        {
            int count = 0;
            foreach (CenterlineRecord centerline in Centerlines)
            {
                if ((!requireText || centerline.MatchedByText)
                    && (!requireStyle || centerline.MatchedByStyle))
                {
                    count++;
                }
            }
            return count;
        }

        int CountDirection(string directionClass)
        {
            int count = 0;
            foreach (CenterlineRecord centerline in Centerlines)
            {
                if (string.Equals(
                    centerline.DirectionClass,
                    directionClass,
                    StringComparison.Ordinal))
                {
                    count++;
                }
            }
            return count;
        }

        int CountScope(string ownerScope)
        {
            int count = 0;
            foreach (CenterlineRecord centerline in Centerlines)
            {
                if (string.Equals(
                    centerline.OwnerScope,
                    ownerScope,
                    StringComparison.OrdinalIgnoreCase))
                {
                    count++;
                }
            }
            return count;
        }

        static CenterlineCoordinateSpaceSummary GetSpaceSummary(
            IDictionary<string, CenterlineCoordinateSpaceSummary> bySpace,
            string ownerScope,
            string ownerBlockName)
        {
            string key = SpaceKey(ownerScope, ownerBlockName);
            CenterlineCoordinateSpaceSummary summary;
            if (!bySpace.TryGetValue(key, out summary))
            {
                summary = new CenterlineCoordinateSpaceSummary(ownerScope, ownerBlockName);
                bySpace.Add(key, summary);
            }
            return summary;
        }

        static bool SameSpace(
            string leftScope,
            string leftBlock,
            string rightScope,
            string rightBlock)
        {
            return string.Equals(leftScope, rightScope ?? "", StringComparison.OrdinalIgnoreCase)
                && string.Equals(leftBlock, rightBlock ?? "", StringComparison.OrdinalIgnoreCase);
        }

        static int CompareSpaces(
            CenterlineCoordinateSpaceSummary left,
            CenterlineCoordinateSpaceSummary right)
        {
            int scope = ScopeRank(left.OwnerScope).CompareTo(ScopeRank(right.OwnerScope));
            if (scope != 0)
            {
                return scope;
            }
            return string.Compare(
                left.OwnerBlockName,
                right.OwnerBlockName,
                StringComparison.OrdinalIgnoreCase);
        }

        static int ScopeRank(string ownerScope)
        {
            if (string.Equals(ownerScope, "model_space", StringComparison.OrdinalIgnoreCase))
            {
                return 0;
            }
            if (string.Equals(ownerScope, "block_definition", StringComparison.OrdinalIgnoreCase))
            {
                return 1;
            }
            if (string.Equals(ownerScope, "paper_space", StringComparison.OrdinalIgnoreCase))
            {
                return 2;
            }
            if (string.Equals(ownerScope, "xref", StringComparison.OrdinalIgnoreCase))
            {
                return 3;
            }
            return 4;
        }

        static void AppendLabels(
            StringBuilder markdown,
            IList<CenterlineLabelBinding> bindings)
        {
            bool first = true;
            foreach (CenterlineLabelBinding binding in bindings)
            {
                if (!first)
                {
                    markdown.Append("、");
                }
                markdown.Append('`');
                markdown.Append(EscapeInline(binding.Text));
                markdown.Append("`（Leader `");
                markdown.Append(EscapeInline(binding.LeaderHandle));
                markdown.Append("`）");
                first = false;
            }
        }

        static string JoinInline(IList<string> values)
        {
            var result = new StringBuilder();
            foreach (string value in values)
            {
                if (result.Length > 0)
                {
                    result.Append(", ");
                }
                result.Append(value ?? "");
            }
            return result.ToString();
        }

        static string Format(double value)
        {
            return value.ToString("0.###", CultureInfo.InvariantCulture);
        }

        static string SpaceKey(string ownerScope, string ownerBlockName)
        {
            return (ownerScope ?? "") + ":" + (ownerBlockName ?? "");
        }

        static string EscapeInline(string value)
        {
            return (value ?? "")
                .Replace("\r", " ")
                .Replace("\n", " ")
                .Replace("`", "\\`");
        }
    }

    public static class CenterlineIdentifier
    {
        public static IList<CenterlineRecord> FindByText(
            IList<CenterlineLayerObservation> layers,
            IList<CenterlinePrimitiveObservation> primitives,
            IList<CenterlineLabelLeaderObservation> labelLeaders,
            CenterlineIdentificationConfig config = null)
        {
            RequireInputs(layers, primitives, labelLeaders);
            config = config ?? new CenterlineIdentificationConfig();
            Validate(config);
            Dictionary<string, CenterlineLayerObservation> layerByName = LayerMap(layers);
            var byPrimitive = new Dictionary<string, CenterlineRecord>(
                StringComparer.OrdinalIgnoreCase);
            foreach (CenterlineLabelLeaderObservation leader in labelLeaders)
            {
                if (leader == null
                    || !Contains(leader.Text, config.CenterlineTextMarker))
                {
                    continue;
                }
                CenterlinePrimitiveObservation closest = null;
                double closestX = 0;
                double closestY = 0;
                double closestDistance = double.MaxValue;
                foreach (CenterlinePrimitiveObservation primitive in primitives)
                {
                    if (primitive == null
                        || primitive.IsDegenerate(config.GeometryTolerance)
                        || !SameCoordinateSpace(primitive, leader))
                    {
                        continue;
                    }
                    double geometryX;
                    double geometryY;
                    double distance;
                    if (!CenterlineGeometryMath.TryClosestPoint(
                        primitive,
                        leader.StartX,
                        leader.StartY,
                        out geometryX,
                        out geometryY,
                        out distance))
                    {
                        continue;
                    }
                    if (distance < closestDistance - 1e-9
                        || (Math.Abs(distance - closestDistance) <= 1e-9
                            && ComparePrimitiveHandle(primitive, closest) < 0))
                    {
                        closest = primitive;
                        closestX = geometryX;
                        closestY = geometryY;
                        closestDistance = distance;
                    }
                }
                if (closest == null || closestDistance > config.LeaderTargetTolerance)
                {
                    continue;
                }
                string key = PrimitiveKey(closest);
                CenterlineRecord record;
                if (!byPrimitive.TryGetValue(key, out record))
                {
                    record = CreateRecord(closest, layerByName, config);
                    record.MatchedByText = true;
                    byPrimitive.Add(key, record);
                }
                record.AddLabelBinding(new CenterlineLabelBinding(
                    leader,
                    closestX,
                    closestY,
                    closestDistance));
            }
            return Sorted(byPrimitive.Values);
        }

        public static IList<CenterlineRecord> FindByStyle(
            IList<CenterlineLayerObservation> layers,
            IList<CenterlinePrimitiveObservation> primitives,
            CenterlineIdentificationConfig config = null)
        {
            if (layers == null)
            {
                throw new ArgumentNullException("layers");
            }
            if (primitives == null)
            {
                throw new ArgumentNullException("primitives");
            }
            config = config ?? new CenterlineIdentificationConfig();
            Validate(config);
            Dictionary<string, CenterlineLayerObservation> layerByName = LayerMap(layers);
            var result = new List<CenterlineRecord>();
            foreach (CenterlinePrimitiveObservation primitive in primitives)
            {
                if (primitive == null || primitive.IsDegenerate(config.GeometryTolerance))
                {
                    continue;
                }
                CenterlineRecord record = CreateRecord(primitive, layerByName, config);
                CenterlineLayerObservation layer;
                layerByName.TryGetValue(primitive.Layer, out layer);
                if (Contains(primitive.Layer, config.CenterlineTextMarker))
                {
                    record.AddStyleMatch("layer_name_contains_centerline");
                }
                if (ContainsIgnoreCase(
                    primitive.EntityLinetype,
                    config.CenterLinetypeMarker))
                {
                    record.AddStyleMatch("entity_linetype_contains_center");
                }
                if (layer != null
                    && ContainsIgnoreCase(layer.Linetype, config.CenterLinetypeMarker))
                {
                    record.AddStyleMatch("layer_linetype_contains_center");
                }
                if (record.StyleMatches.Count == 0)
                {
                    continue;
                }
                record.MatchedByStyle = true;
                result.Add(record);
            }
            result.Sort(CompareRecords);
            return result;
        }

        public static CenterlineIdentificationDocument Identify(
            string drawingId,
            IList<CenterlineLayerObservation> layers,
            IList<CenterlinePrimitiveObservation> primitives,
            IList<CenterlineLabelLeaderObservation> labelLeaders,
            CenterlineIdentificationConfig config = null)
        {
            config = config ?? new CenterlineIdentificationConfig();
            IList<CenterlineRecord> byStyle = FindByStyle(layers, primitives, config);
            IList<CenterlineRecord> byText = FindByText(
                layers,
                primitives,
                labelLeaders,
                config);
            var union = new Dictionary<string, CenterlineRecord>(
                StringComparer.OrdinalIgnoreCase);
            MergeInto(union, byStyle);
            MergeInto(union, byText);

            var document = new CenterlineIdentificationDocument(drawingId);
            List<CenterlineRecord> records = Sorted(union.Values);
            for (int index = 0; index < records.Count; index++)
            {
                records[index].Id = "center-geometry-"
                    + (index + 1).ToString(CultureInfo.InvariantCulture);
                document.Centerlines.Add(records[index]);
            }
            CenterlineShapeClassifier.Analyze(document, config);
            return document;
        }

        static CenterlineRecord CreateRecord(
            CenterlinePrimitiveObservation primitive,
            IDictionary<string, CenterlineLayerObservation> layerByName,
            CenterlineIdentificationConfig config)
        {
            CenterlineLayerObservation layer;
            layerByName.TryGetValue(primitive.Layer, out layer);
            return new CenterlineRecord(
                primitive,
                layer,
                config.DirectionAxisToleranceDegrees);
        }

        static void MergeInto(
            IDictionary<string, CenterlineRecord> target,
            IList<CenterlineRecord> source)
        {
            foreach (CenterlineRecord record in source)
            {
                string key = RecordKey(record);
                CenterlineRecord existing;
                if (!target.TryGetValue(key, out existing))
                {
                    target.Add(key, record);
                }
                else
                {
                    existing.Merge(record);
                }
            }
        }

        static Dictionary<string, CenterlineLayerObservation> LayerMap(
            IList<CenterlineLayerObservation> layers)
        {
            var result = new Dictionary<string, CenterlineLayerObservation>(
                StringComparer.OrdinalIgnoreCase);
            foreach (CenterlineLayerObservation layer in layers)
            {
                if (layer != null && !string.IsNullOrEmpty(layer.Name))
                {
                    result[layer.Name] = layer;
                }
            }
            return result;
        }

        static bool SameCoordinateSpace(
            CenterlinePrimitiveObservation primitive,
            CenterlineLabelLeaderObservation leader)
        {
            return string.Equals(
                    primitive.OwnerScope,
                    leader.OwnerScope,
                    StringComparison.OrdinalIgnoreCase)
                && string.Equals(
                    primitive.OwnerBlockName,
                    leader.OwnerBlockName,
                    StringComparison.OrdinalIgnoreCase);
        }

        static int ComparePrimitiveHandle(
            CenterlinePrimitiveObservation left,
            CenterlinePrimitiveObservation right)
        {
            if (right == null)
            {
                return -1;
            }
            return string.Compare(left.Handle, right.Handle, StringComparison.OrdinalIgnoreCase);
        }

        static string PrimitiveKey(CenterlinePrimitiveObservation primitive)
        {
            return SpaceKey(primitive.OwnerScope, primitive.OwnerBlockName)
                + ":" + primitive.Handle;
        }

        static string RecordKey(CenterlineRecord record)
        {
            return SpaceKey(record.OwnerScope, record.OwnerBlockName)
                + ":" + record.Handle;
        }

        static List<CenterlineRecord> Sorted(IEnumerable<CenterlineRecord> values)
        {
            var result = new List<CenterlineRecord>(values);
            result.Sort(CompareRecords);
            return result;
        }

        static int CompareRecords(CenterlineRecord left, CenterlineRecord right)
        {
            int scope = ScopeRank(left.OwnerScope).CompareTo(ScopeRank(right.OwnerScope));
            if (scope != 0)
            {
                return scope;
            }
            int block = string.Compare(
                left.OwnerBlockName,
                right.OwnerBlockName,
                StringComparison.OrdinalIgnoreCase);
            if (block != 0)
            {
                return block;
            }
            int kind = string.Compare(
                left.GeometryKind,
                right.GeometryKind,
                StringComparison.Ordinal);
            return kind != 0
                ? kind
                : string.Compare(left.Handle, right.Handle, StringComparison.OrdinalIgnoreCase);
        }

        static int ScopeRank(string ownerScope)
        {
            if (string.Equals(ownerScope, "model_space", StringComparison.OrdinalIgnoreCase))
            {
                return 0;
            }
            if (string.Equals(ownerScope, "block_definition", StringComparison.OrdinalIgnoreCase))
            {
                return 1;
            }
            if (string.Equals(ownerScope, "paper_space", StringComparison.OrdinalIgnoreCase))
            {
                return 2;
            }
            if (string.Equals(ownerScope, "xref", StringComparison.OrdinalIgnoreCase))
            {
                return 3;
            }
            return 4;
        }

        static string SpaceKey(string ownerScope, string ownerBlockName)
        {
            return (ownerScope ?? "") + ":" + (ownerBlockName ?? "");
        }

        static bool Contains(string value, string marker)
        {
            return !string.IsNullOrEmpty(marker)
                && (value ?? "").IndexOf(marker, StringComparison.Ordinal) >= 0;
        }

        static bool ContainsIgnoreCase(string value, string marker)
        {
            return !string.IsNullOrEmpty(marker)
                && (value ?? "").IndexOf(marker, StringComparison.OrdinalIgnoreCase) >= 0;
        }

        static void RequireInputs(
            IList<CenterlineLayerObservation> layers,
            IList<CenterlinePrimitiveObservation> primitives,
            IList<CenterlineLabelLeaderObservation> labelLeaders)
        {
            if (layers == null)
            {
                throw new ArgumentNullException("layers");
            }
            if (primitives == null)
            {
                throw new ArgumentNullException("primitives");
            }
            if (labelLeaders == null)
            {
                throw new ArgumentNullException("labelLeaders");
            }
        }

        static void Validate(CenterlineIdentificationConfig config)
        {
            if (string.IsNullOrWhiteSpace(config.CenterlineTextMarker)
                || string.IsNullOrWhiteSpace(config.CenterLinetypeMarker))
            {
                throw new ArgumentException("Centerline markers must not be empty.", "config");
            }
            if (config.LeaderTargetTolerance < 0
                || config.GeometryTolerance <= 0
                || config.DirectionAxisToleranceDegrees < 0
                || config.DirectionAxisToleranceDegrees >= 45
                || config.TangentToleranceDegrees < 0
                || config.TangentToleranceDegrees >= 45)
            {
                throw new ArgumentOutOfRangeException("config");
            }
        }
    }

    internal static class CenterlineMaps
    {
        public static Dictionary<string, object> Map(params object[] pairs)
        {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            for (int index = 0; index < pairs.Length; index += 2)
            {
                result[(string)pairs[index]] = pairs[index + 1];
            }
            return result;
        }
    }
}
