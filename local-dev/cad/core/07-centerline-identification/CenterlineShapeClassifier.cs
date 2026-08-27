using System;
using System.Collections.Generic;
using System.Globalization;

namespace Shb.Cad.Core
{
    public sealed class CenterlineNeighborhoodWindow
    {
        internal CenterlineNeighborhoodWindow(
            string ownerScope,
            string ownerBlockName,
            double centerX,
            double centerY,
            double halfWidth,
            double halfHeight)
        {
            OwnerScope = ownerScope ?? "";
            OwnerBlockName = ownerBlockName ?? "";
            CenterX = centerX;
            CenterY = centerY;
            MinX = centerX - halfWidth;
            MinY = centerY - halfHeight;
            MaxX = centerX + halfWidth;
            MaxY = centerY + halfHeight;
        }

        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public double CenterX { get; private set; }
        public double CenterY { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return CenterlineMaps.Map(
                "owner_scope", OwnerScope,
                "owner_block_name", OwnerBlockName,
                "center", new[] { CenterX, CenterY },
                "min", new[] { MinX, MinY },
                "max", new[] { MaxX, MaxY });
        }
    }

    public sealed class CenterlineShapeRecord
    {
        internal CenterlineShapeRecord(
            string shapeType,
            string shapeSubtype,
            string ownerScope,
            string ownerBlockName)
        {
            ShapeType = shapeType ?? "";
            ShapeSubtype = shapeSubtype ?? "";
            OwnerScope = ownerScope ?? "";
            OwnerBlockName = ownerBlockName ?? "";
            PrimitiveHandles = new List<string>();
            GeometryKinds = new List<string>();
            TurnAnglesDegrees = new List<double>();
            CenterX = double.NaN;
            CenterY = double.NaN;
            Radius = double.NaN;
            SweepDegrees = double.NaN;
            StartX = double.NaN;
            StartY = double.NaN;
            EndX = double.NaN;
            EndY = double.NaN;
        }

        public string Id { get; internal set; }
        public string ShapeType { get; private set; }
        public string ShapeSubtype { get; private set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public IList<string> PrimitiveHandles { get; private set; }
        public IList<string> GeometryKinds { get; private set; }
        public bool Closed { get; internal set; }
        public double PathLength { get; internal set; }
        public double CenterX { get; internal set; }
        public double CenterY { get; internal set; }
        public double Radius { get; internal set; }
        public double SweepDegrees { get; internal set; }
        public double StartX { get; internal set; }
        public double StartY { get; internal set; }
        public double EndX { get; internal set; }
        public double EndY { get; internal set; }
        public IList<double> TurnAnglesDegrees { get; private set; }

        internal void AddPrimitive(CenterlineRecord centerline)
        {
            AddUnique(PrimitiveHandles, centerline.Handle);
            AddUnique(GeometryKinds, centerline.GeometryKind);
            PathLength += centerline.Length;
        }

        internal Dictionary<string, object> ToMap()
        {
            var result = CenterlineMaps.Map(
                "id", Id,
                "shape_type", ShapeType,
                "shape_subtype", ShapeSubtype,
                "owner_scope", OwnerScope,
                "owner_block_name", OwnerBlockName,
                "coordinate_space", SpaceKey(OwnerScope, OwnerBlockName),
                "primitive_handles", PrimitiveHandles,
                "geometry_kinds", GeometryKinds,
                "closed", Closed,
                "path_length", PathLength,
                "turn_angles_degrees", TurnAnglesDegrees);
            if (!double.IsNaN(StartX))
            {
                result["start"] = new[] { StartX, StartY };
                result["end"] = new[] { EndX, EndY };
            }
            if (!double.IsNaN(CenterX))
            {
                result["center"] = new[] { CenterX, CenterY };
            }
            if (!double.IsNaN(Radius))
            {
                result["radius"] = Radius;
            }
            if (!double.IsNaN(SweepDegrees))
            {
                result["sweep_degrees"] = SweepDegrees;
            }
            return result;
        }

        static void AddUnique(IList<string> values, string value)
        {
            foreach (string existing in values)
            {
                if (string.Equals(existing, value, StringComparison.Ordinal))
                {
                    return;
                }
            }
            values.Add(value ?? "");
        }

        static string SpaceKey(string ownerScope, string ownerBlockName)
        {
            return (ownerScope ?? "") + ":" + (ownerBlockName ?? "");
        }
    }

    public sealed class CenterlineIntersection
    {
        internal CenterlineIntersection(
            string ownerScope,
            string ownerBlockName,
            double x,
            double y,
            string intersectionType,
            bool endpointJoin,
            IList<string> primitiveHandles,
            IList<string> geometryKinds,
            IList<double> crossingAnglesDegrees)
        {
            OwnerScope = ownerScope ?? "";
            OwnerBlockName = ownerBlockName ?? "";
            X = x;
            Y = y;
            IntersectionType = intersectionType ?? "";
            EndpointJoin = endpointJoin;
            PrimitiveHandles = new List<string>(primitiveHandles);
            GeometryKinds = new List<string>(geometryKinds);
            CrossingAnglesDegrees = new List<double>(crossingAnglesDegrees);
        }

        public string Id { get; internal set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public double X { get; private set; }
        public double Y { get; private set; }
        public string IntersectionType { get; private set; }
        public bool EndpointJoin { get; private set; }
        public IList<string> PrimitiveHandles { get; private set; }
        public IList<string> GeometryKinds { get; private set; }
        public IList<double> CrossingAnglesDegrees { get; private set; }

        public CenterlineNeighborhoodWindow Around(double halfSize)
        {
            return Around(halfSize, halfSize);
        }

        public CenterlineNeighborhoodWindow Around(double halfWidth, double halfHeight)
        {
            if (halfWidth < 0 || halfHeight < 0)
            {
                throw new ArgumentOutOfRangeException("halfWidth");
            }
            return new CenterlineNeighborhoodWindow(
                OwnerScope,
                OwnerBlockName,
                X,
                Y,
                halfWidth,
                halfHeight);
        }

        internal Dictionary<string, object> ToMap()
        {
            return CenterlineMaps.Map(
                "id", Id,
                "owner_scope", OwnerScope,
                "owner_block_name", OwnerBlockName,
                "coordinate_space", (OwnerScope ?? "") + ":" + (OwnerBlockName ?? ""),
                "point", new[] { X, Y },
                "intersection_type", IntersectionType,
                "endpoint_join", EndpointJoin,
                "primitive_handles", PrimitiveHandles,
                "geometry_kinds", GeometryKinds,
                "crossing_angles_degrees", CrossingAnglesDegrees,
                "visual_anchor", true,
                "neighborhood_operation", "around(half_width, half_height)");
        }
    }

    public static class CenterlineShapeClassifier
    {
        public static void Analyze(
            CenterlineIdentificationDocument document,
            CenterlineIdentificationConfig config)
        {
            if (document == null)
            {
                throw new ArgumentNullException("document");
            }
            if (config == null)
            {
                throw new ArgumentNullException("config");
            }
            document.Shapes.Clear();
            document.Intersections.Clear();
            BuildShapes(document, config);
            BuildIntersections(document, config);
        }

        static void BuildShapes(
            CenterlineIdentificationDocument document,
            CenterlineIdentificationConfig config)
        {
            var pathRecords = new List<CenterlineRecord>();
            foreach (CenterlineRecord centerline in document.Centerlines)
            {
                if (string.Equals(centerline.GeometryKind, "line", StringComparison.Ordinal)
                    || string.Equals(centerline.GeometryKind, "arc", StringComparison.Ordinal))
                {
                    pathRecords.Add(centerline);
                }
                else
                {
                    document.Shapes.Add(ShapeForStandalone(centerline, config));
                }
            }

            var groupsBySpace = GroupBySpace(pathRecords);
            foreach (List<CenterlineRecord> group in groupsBySpace.Values)
            {
                var union = new CenterlineUnionFind(group.Count);
                for (int leftIndex = 0; leftIndex < group.Count; leftIndex++)
                {
                    for (int rightIndex = leftIndex + 1;
                        rightIndex < group.Count;
                        rightIndex++)
                    {
                        if (CenterlineGeometryMath.HaveTangentEndpointJoin(
                            group[leftIndex].Primitive,
                            group[rightIndex].Primitive,
                            config.GeometryTolerance,
                            config.TangentToleranceDegrees))
                        {
                            union.Join(leftIndex, rightIndex);
                        }
                    }
                }
                var components = new Dictionary<int, List<CenterlineRecord>>();
                for (int index = 0; index < group.Count; index++)
                {
                    int root = union.Find(index);
                    List<CenterlineRecord> component;
                    if (!components.TryGetValue(root, out component))
                    {
                        component = new List<CenterlineRecord>();
                        components.Add(root, component);
                    }
                    component.Add(group[index]);
                }
                foreach (List<CenterlineRecord> component in components.Values)
                {
                    document.Shapes.Add(ShapeForPathComponent(component, config));
                }
            }

            var shapes = document.Shapes as List<CenterlineShapeRecord>;
            if (shapes != null)
            {
                shapes.Sort(CompareShapes);
            }
            for (int index = 0; index < document.Shapes.Count; index++)
            {
                CenterlineShapeRecord shape = document.Shapes[index];
                shape.Id = "center-shape-"
                    + (index + 1).ToString(CultureInfo.InvariantCulture);
                foreach (CenterlineRecord centerline in document.Centerlines)
                {
                    if (SameSpace(
                            centerline.OwnerScope,
                            centerline.OwnerBlockName,
                            shape.OwnerScope,
                            shape.OwnerBlockName)
                        && Contains(shape.PrimitiveHandles, centerline.Handle))
                    {
                        centerline.AddShapeId(shape.Id);
                    }
                }
            }
        }

        static CenterlineShapeRecord ShapeForStandalone(
            CenterlineRecord centerline,
            CenterlineIdentificationConfig config)
        {
            CenterlinePrimitiveObservation primitive = centerline.Primitive;
            CenterlineShapeRecord shape;
            if (string.Equals(primitive.GeometryKind, "circle", StringComparison.Ordinal))
            {
                shape = new CenterlineShapeRecord(
                    "circular_reference",
                    "full_circle",
                    centerline.OwnerScope,
                    centerline.OwnerBlockName);
                shape.Closed = true;
                shape.CenterX = primitive.CenterX;
                shape.CenterY = primitive.CenterY;
                shape.Radius = primitive.Radius;
                shape.SweepDegrees = 360;
            }
            else if (string.Equals(primitive.GeometryKind, "polyline", StringComparison.Ordinal))
            {
                string type = primitive.Closed
                    ? "closed_polyline_path"
                    : (IsReturnPolyline(primitive, config.TangentToleranceDegrees)
                        ? "u_polyline_path"
                        : "polyline_path");
                string subtype = HasBulge(primitive)
                    ? "contains_arc_segments"
                    : "straight_segments";
                shape = new CenterlineShapeRecord(
                    type,
                    subtype,
                    centerline.OwnerScope,
                    centerline.OwnerBlockName);
                shape.Closed = primitive.Closed;
                AddPolylineTurns(shape, primitive);
                if (primitive.Vertices.Count > 0)
                {
                    shape.StartX = primitive.Vertices[0].X;
                    shape.StartY = primitive.Vertices[0].Y;
                    shape.EndX = primitive.Closed
                        ? primitive.Vertices[0].X
                        : primitive.Vertices[primitive.Vertices.Count - 1].X;
                    shape.EndY = primitive.Closed
                        ? primitive.Vertices[0].Y
                        : primitive.Vertices[primitive.Vertices.Count - 1].Y;
                }
            }
            else
            {
                shape = new CenterlineShapeRecord(
                    "spline_path",
                    primitive.Closed ? "closed" : "open",
                    centerline.OwnerScope,
                    centerline.OwnerBlockName);
                shape.Closed = primitive.Closed;
                if (primitive.ControlPoints.Count > 0)
                {
                    shape.StartX = primitive.ControlPoints[0].X;
                    shape.StartY = primitive.ControlPoints[0].Y;
                    shape.EndX = primitive.Closed
                        ? primitive.ControlPoints[0].X
                        : primitive.ControlPoints[primitive.ControlPoints.Count - 1].X;
                    shape.EndY = primitive.Closed
                        ? primitive.ControlPoints[0].Y
                        : primitive.ControlPoints[primitive.ControlPoints.Count - 1].Y;
                }
            }
            shape.AddPrimitive(centerline);
            return shape;
        }

        static CenterlineShapeRecord ShapeForPathComponent(
            IList<CenterlineRecord> component,
            CenterlineIdentificationConfig config)
        {
            int lineCount = 0;
            int arcCount = 0;
            foreach (CenterlineRecord centerline in component)
            {
                if (string.Equals(centerline.GeometryKind, "line", StringComparison.Ordinal))
                {
                    lineCount++;
                }
                else if (string.Equals(centerline.GeometryKind, "arc", StringComparison.Ordinal))
                {
                    arcCount++;
                }
            }

            string type;
            string subtype = "";
            if (arcCount == 0)
            {
                type = component.Count == 1 ? "straight_axis" : "straight_axis_chain";
                subtype = component[0].DirectionClass;
            }
            else if (component.Count == 1)
            {
                type = "arc_path";
                subtype = ArcSubtype(component[0].Primitive.ArcSweepRadians * 180.0 / Math.PI);
            }
            else if (arcCount == 1 && lineCount >= 1)
            {
                type = "rounded_bend_path";
                CenterlineRecord arc = FindFirstKind(component, "arc");
                subtype = ArcSubtype(arc.Primitive.ArcSweepRadians * 180.0 / Math.PI);
            }
            else if (lineCount == 0 && ComponentIsClosed(component, config.GeometryTolerance))
            {
                type = "circular_arc_chain";
                subtype = "closed";
            }
            else
            {
                type = "composite_center_path";
            }

            var shape = new CenterlineShapeRecord(
                type,
                subtype,
                component[0].OwnerScope,
                component[0].OwnerBlockName);
            foreach (CenterlineRecord centerline in component)
            {
                shape.AddPrimitive(centerline);
                if (string.Equals(centerline.GeometryKind, "arc", StringComparison.Ordinal))
                {
                    shape.TurnAnglesDegrees.Add(
                        centerline.Primitive.ArcSweepRadians * 180.0 / Math.PI);
                    if (double.IsNaN(shape.Radius))
                    {
                        shape.Radius = centerline.Primitive.Radius;
                    }
                }
            }
            shape.Closed = ComponentIsClosed(component, config.GeometryTolerance);
            SetComponentEnds(shape, component, config.GeometryTolerance);
            if (component.Count == 1
                && string.Equals(component[0].GeometryKind, "arc", StringComparison.Ordinal))
            {
                CenterlinePrimitiveObservation arc = component[0].Primitive;
                shape.CenterX = arc.CenterX;
                shape.CenterY = arc.CenterY;
                shape.Radius = arc.Radius;
                shape.SweepDegrees = arc.ArcSweepRadians * 180.0 / Math.PI;
            }
            return shape;
        }

        static void BuildIntersections(
            CenterlineIdentificationDocument document,
            CenterlineIdentificationConfig config)
        {
            var groups = GroupBySpace(new List<CenterlineRecord>(document.Centerlines));
            var intersections = new List<CenterlineIntersection>();
            foreach (List<CenterlineRecord> group in groups.Values)
            {
                var clusters = new CenterlineIntersectionClusters(
                    group[0].OwnerScope,
                    group[0].OwnerBlockName,
                    config.GeometryTolerance,
                    config.TangentToleranceDegrees);
                var segmentsByRecord = new Dictionary<CenterlineRecord, List<CenterlineCurveSegment>>();
                foreach (CenterlineRecord centerline in group)
                {
                    segmentsByRecord[centerline] = CenterlineGeometryMath.Flatten(
                        centerline.Primitive,
                        false);
                }
                for (int leftIndex = 0; leftIndex < group.Count; leftIndex++)
                {
                    CenterlineRecord left = group[leftIndex];
                    List<CenterlineCurveSegment> leftSegments = segmentsByRecord[left];
                    if (leftSegments.Count == 0)
                    {
                        continue;
                    }
                    for (int rightIndex = leftIndex + 1;
                        rightIndex < group.Count;
                        rightIndex++)
                    {
                        CenterlineRecord right = group[rightIndex];
                        List<CenterlineCurveSegment> rightSegments = segmentsByRecord[right];
                        if (rightSegments.Count == 0
                            || !CenterlineGeometryMath.BoundsOverlap(
                                leftSegments,
                                rightSegments,
                                config.GeometryTolerance))
                        {
                            continue;
                        }
                        foreach (CenterlineCurveSegment leftSegment in leftSegments)
                        {
                            foreach (CenterlineCurveSegment rightSegment in rightSegments)
                            {
                                foreach (CenterlineRawIntersection raw in
                                    CenterlineGeometryMath.Intersections(
                                        leftSegment,
                                        rightSegment,
                                        config.GeometryTolerance))
                                {
                                    raw.LeftHandle = left.Handle;
                                    raw.LeftGeometryKind = left.GeometryKind;
                                    raw.RightHandle = right.Handle;
                                    raw.RightGeometryKind = right.GeometryKind;
                                    clusters.Add(raw);
                                }
                            }
                        }
                    }
                }
                intersections.AddRange(clusters.Build());
            }
            intersections.Sort(CompareIntersections);
            for (int index = 0; index < intersections.Count; index++)
            {
                CenterlineIntersection intersection = intersections[index];
                intersection.Id = "center-intersection-"
                    + (index + 1).ToString(CultureInfo.InvariantCulture);
                document.Intersections.Add(intersection);
                foreach (CenterlineRecord centerline in document.Centerlines)
                {
                    if (SameSpace(
                            centerline.OwnerScope,
                            centerline.OwnerBlockName,
                            intersection.OwnerScope,
                            intersection.OwnerBlockName)
                        && Contains(intersection.PrimitiveHandles, centerline.Handle))
                    {
                        centerline.AddIntersectionId(intersection.Id);
                    }
                }
            }
        }

        static Dictionary<string, List<CenterlineRecord>> GroupBySpace(
            IList<CenterlineRecord> records)
        {
            var result = new Dictionary<string, List<CenterlineRecord>>(
                StringComparer.OrdinalIgnoreCase);
            foreach (CenterlineRecord record in records)
            {
                string key = (record.OwnerScope ?? "") + ":" + (record.OwnerBlockName ?? "");
                List<CenterlineRecord> group;
                if (!result.TryGetValue(key, out group))
                {
                    group = new List<CenterlineRecord>();
                    result.Add(key, group);
                }
                group.Add(record);
            }
            return result;
        }

        static bool IsReturnPolyline(
            CenterlinePrimitiveObservation primitive,
            double angleTolerance)
        {
            if (primitive.Closed || HasBulge(primitive))
            {
                return false;
            }
            if (primitive.Vertices.Count == 4)
            {
                double first = SegmentOrientation(primitive.Vertices[0], primitive.Vertices[1]);
                double middle = SegmentOrientation(primitive.Vertices[1], primitive.Vertices[2]);
                double last = SegmentOrientation(primitive.Vertices[2], primitive.Vertices[3]);
                return ParallelDifference(first, last) <= angleTolerance
                    && Math.Abs(90.0 - ParallelDifference(first, middle)) <= angleTolerance;
            }
            if (primitive.Vertices.Count == 6)
            {
                double first = SegmentOrientation(primitive.Vertices[0], primitive.Vertices[1]);
                double second = SegmentOrientation(primitive.Vertices[1], primitive.Vertices[2]);
                double third = SegmentOrientation(primitive.Vertices[2], primitive.Vertices[3]);
                double fourth = SegmentOrientation(primitive.Vertices[3], primitive.Vertices[4]);
                double fifth = SegmentOrientation(primitive.Vertices[4], primitive.Vertices[5]);
                return ParallelDifference(first, third) <= angleTolerance
                    && ParallelDifference(first, fifth) <= angleTolerance
                    && ParallelDifference(second, fourth) <= angleTolerance
                    && Math.Abs(90.0 - ParallelDifference(first, second)) <= angleTolerance;
            }
            return false;
        }

        static void AddPolylineTurns(
            CenterlineShapeRecord shape,
            CenterlinePrimitiveObservation primitive)
        {
            if (primitive.Vertices.Count < 3)
            {
                return;
            }
            int startIndex = primitive.Closed ? 0 : 1;
            int endIndex = primitive.Closed
                ? primitive.Vertices.Count
                : primitive.Vertices.Count - 1;
            for (int index = startIndex; index < endIndex; index++)
            {
                double before = SegmentOrientation(
                    primitive.Vertices[(index - 1 + primitive.Vertices.Count)
                        % primitive.Vertices.Count],
                    primitive.Vertices[index]);
                double after = SegmentOrientation(
                    primitive.Vertices[index],
                    primitive.Vertices[(index + 1) % primitive.Vertices.Count]);
                shape.TurnAnglesDegrees.Add(ParallelDifference(before, after));
            }
        }

        static bool HasBulge(CenterlinePrimitiveObservation primitive)
        {
            foreach (CenterlineVertexObservation vertex in primitive.Vertices)
            {
                if (Math.Abs(vertex.Bulge) > 1e-12)
                {
                    return true;
                }
            }
            return false;
        }

        static double SegmentOrientation(
            CenterlineVertexObservation start,
            CenterlineVertexObservation end)
        {
            double value = Math.Atan2(end.Y - start.Y, end.X - start.X) * 180.0 / Math.PI;
            value %= 180.0;
            return value < 0 ? value + 180.0 : value;
        }

        static double ParallelDifference(double left, double right)
        {
            double value = Math.Abs(left - right) % 180.0;
            return Math.Min(value, 180.0 - value);
        }

        static string ArcSubtype(double sweepDegrees)
        {
            if (Math.Abs(sweepDegrees - 90.0) <= 0.01)
            {
                return "quarter_bend";
            }
            if (Math.Abs(sweepDegrees - 180.0) <= 0.01)
            {
                return "semicircular_return";
            }
            if (Math.Abs(sweepDegrees - 270.0) <= 0.01)
            {
                return "three_quarter_arc";
            }
            return "free_angle_arc";
        }

        static CenterlineRecord FindFirstKind(
            IList<CenterlineRecord> component,
            string kind)
        {
            foreach (CenterlineRecord centerline in component)
            {
                if (string.Equals(centerline.GeometryKind, kind, StringComparison.Ordinal))
                {
                    return centerline;
                }
            }
            return null;
        }

        static bool ComponentIsClosed(
            IList<CenterlineRecord> component,
            double tolerance)
        {
            if (component.Count == 1)
            {
                return false;
            }
            var endpoints = new List<CenterlinePointObservation>();
            foreach (CenterlineRecord centerline in component)
            {
                CenterlinePointObservation start;
                CenterlinePointObservation end;
                if (CenterlineGeometryMath.TryEndpoints(centerline.Primitive, out start, out end))
                {
                    endpoints.Add(start);
                    endpoints.Add(end);
                }
            }
            foreach (CenterlinePointObservation endpoint in endpoints)
            {
                int near = 0;
                foreach (CenterlinePointObservation other in endpoints)
                {
                    if (!object.ReferenceEquals(endpoint, other)
                        && Distance(endpoint.X, endpoint.Y, other.X, other.Y) <= tolerance)
                    {
                        near++;
                    }
                }
                if (near == 0)
                {
                    return false;
                }
            }
            return endpoints.Count > 0;
        }

        static void SetComponentEnds(
            CenterlineShapeRecord shape,
            IList<CenterlineRecord> component,
            double tolerance)
        {
            var endpoints = new List<CenterlinePointObservation>();
            foreach (CenterlineRecord centerline in component)
            {
                CenterlinePointObservation start;
                CenterlinePointObservation end;
                if (CenterlineGeometryMath.TryEndpoints(centerline.Primitive, out start, out end))
                {
                    endpoints.Add(start);
                    endpoints.Add(end);
                }
            }
            var free = new List<CenterlinePointObservation>();
            foreach (CenterlinePointObservation endpoint in endpoints)
            {
                bool joined = false;
                foreach (CenterlinePointObservation other in endpoints)
                {
                    if (!object.ReferenceEquals(endpoint, other)
                        && Distance(endpoint.X, endpoint.Y, other.X, other.Y) <= tolerance)
                    {
                        joined = true;
                        break;
                    }
                }
                if (!joined)
                {
                    free.Add(endpoint);
                }
            }
            if (free.Count >= 2)
            {
                shape.StartX = free[0].X;
                shape.StartY = free[0].Y;
                shape.EndX = free[1].X;
                shape.EndY = free[1].Y;
            }
            else if (endpoints.Count >= 2)
            {
                shape.StartX = endpoints[0].X;
                shape.StartY = endpoints[0].Y;
                shape.EndX = endpoints[1].X;
                shape.EndY = endpoints[1].Y;
            }
        }

        static bool Contains(IList<string> values, string value)
        {
            foreach (string existing in values)
            {
                if (string.Equals(existing, value, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }
            return false;
        }

        static bool SameSpace(
            string leftScope,
            string leftBlock,
            string rightScope,
            string rightBlock)
        {
            return string.Equals(leftScope, rightScope, StringComparison.OrdinalIgnoreCase)
                && string.Equals(leftBlock, rightBlock, StringComparison.OrdinalIgnoreCase);
        }

        static double Distance(double x1, double y1, double x2, double y2)
        {
            double dx = x2 - x1;
            double dy = y2 - y1;
            return Math.Sqrt(dx * dx + dy * dy);
        }

        static int CompareShapes(CenterlineShapeRecord left, CenterlineShapeRecord right)
        {
            int scope = string.Compare(
                left.OwnerScope,
                right.OwnerScope,
                StringComparison.OrdinalIgnoreCase);
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
            int type = string.Compare(left.ShapeType, right.ShapeType, StringComparison.Ordinal);
            if (type != 0)
            {
                return type;
            }
            string leftHandle = left.PrimitiveHandles.Count == 0 ? "" : left.PrimitiveHandles[0];
            string rightHandle = right.PrimitiveHandles.Count == 0 ? "" : right.PrimitiveHandles[0];
            return string.Compare(leftHandle, rightHandle, StringComparison.OrdinalIgnoreCase);
        }

        static int CompareIntersections(
            CenterlineIntersection left,
            CenterlineIntersection right)
        {
            int scope = string.Compare(
                left.OwnerScope,
                right.OwnerScope,
                StringComparison.OrdinalIgnoreCase);
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
            int x = left.X.CompareTo(right.X);
            return x != 0 ? x : left.Y.CompareTo(right.Y);
        }
    }

    internal sealed class CenterlineUnionFind
    {
        readonly int[] parents;

        public CenterlineUnionFind(int count)
        {
            parents = new int[count];
            for (int index = 0; index < count; index++)
            {
                parents[index] = index;
            }
        }

        public int Find(int value)
        {
            if (parents[value] != value)
            {
                parents[value] = Find(parents[value]);
            }
            return parents[value];
        }

        public void Join(int left, int right)
        {
            int leftRoot = Find(left);
            int rightRoot = Find(right);
            if (leftRoot != rightRoot)
            {
                parents[rightRoot] = leftRoot;
            }
        }
    }

    internal sealed class CenterlineCurveSegment
    {
        public string Kind { get; set; }
        public int SegmentIndex { get; set; }
        public double StartX { get; set; }
        public double StartY { get; set; }
        public double EndX { get; set; }
        public double EndY { get; set; }
        public double CenterX { get; set; }
        public double CenterY { get; set; }
        public double Radius { get; set; }
        public double StartAngle { get; set; }
        public double SweepAngle { get; set; }
        public bool Approximate { get; set; }

        public bool IsRadial
        {
            get
            {
                return string.Equals(Kind, "arc", StringComparison.Ordinal)
                    || string.Equals(Kind, "circle", StringComparison.Ordinal);
            }
        }

        public bool HasEndpoints
        {
            get { return !string.Equals(Kind, "circle", StringComparison.Ordinal); }
        }

        public void Bounds(out double minX, out double minY, out double maxX, out double maxY)
        {
            if (IsRadial)
            {
                minX = CenterX - Radius;
                minY = CenterY - Radius;
                maxX = CenterX + Radius;
                maxY = CenterY + Radius;
                return;
            }
            minX = Math.Min(StartX, EndX);
            minY = Math.Min(StartY, EndY);
            maxX = Math.Max(StartX, EndX);
            maxY = Math.Max(StartY, EndY);
        }

        public bool ContainsPointOnCurve(double x, double y, double tolerance)
        {
            if (!IsRadial)
            {
                return CenterlineGeometryMath.PointOnLineSegment(this, x, y, tolerance);
            }
            double radialDistance = Math.Abs(
                CenterlineGeometryMath.Distance(CenterX, CenterY, x, y) - Radius);
            if (radialDistance > tolerance)
            {
                return false;
            }
            if (string.Equals(Kind, "circle", StringComparison.Ordinal))
            {
                return true;
            }
            return ContainsAngle(Math.Atan2(y - CenterY, x - CenterX), tolerance);
        }

        public bool ContainsAngle(double angle, double tolerance)
        {
            if (string.Equals(Kind, "circle", StringComparison.Ordinal))
            {
                return true;
            }
            double angleTolerance = Radius <= 0 ? 0 : tolerance / Radius;
            if (SweepAngle >= 0)
            {
                return CenterlineGeometryMath.NormalizePositive(angle - StartAngle)
                    <= SweepAngle + angleTolerance;
            }
            return CenterlineGeometryMath.NormalizePositive(StartAngle - angle)
                <= -SweepAngle + angleTolerance;
        }

        public double TangentOrientationDegrees(double x, double y)
        {
            double radians;
            if (IsRadial)
            {
                radians = Math.Atan2(y - CenterY, x - CenterX) + Math.PI * 0.5;
            }
            else
            {
                radians = Math.Atan2(EndY - StartY, EndX - StartX);
            }
            double degrees = radians * 180.0 / Math.PI;
            degrees %= 180.0;
            return degrees < 0 ? degrees + 180.0 : degrees;
        }

        public bool IsEndpoint(double x, double y, double tolerance)
        {
            return HasEndpoints
                && (CenterlineGeometryMath.Distance(x, y, StartX, StartY) <= tolerance
                    || CenterlineGeometryMath.Distance(x, y, EndX, EndY) <= tolerance);
        }
    }

    internal sealed class CenterlineRawIntersection
    {
        public double X { get; set; }
        public double Y { get; set; }
        public double LeftOrientation { get; set; }
        public double RightOrientation { get; set; }
        public bool LeftEndpoint { get; set; }
        public bool RightEndpoint { get; set; }
        public string LeftHandle { get; set; }
        public string RightHandle { get; set; }
        public string LeftGeometryKind { get; set; }
        public string RightGeometryKind { get; set; }
    }

    internal static class CenterlineGeometryMath
    {
        public static bool TryClosestPoint(
            CenterlinePrimitiveObservation primitive,
            double x,
            double y,
            out double closestX,
            out double closestY,
            out double distance)
        {
            closestX = 0;
            closestY = 0;
            distance = double.MaxValue;
            List<CenterlineCurveSegment> segments = Flatten(primitive, true);
            if (segments.Count == 0)
            {
                return false;
            }
            foreach (CenterlineCurveSegment segment in segments)
            {
                double segmentX;
                double segmentY;
                double segmentDistance;
                ClosestPoint(segment, x, y, out segmentX, out segmentY, out segmentDistance);
                if (segmentDistance < distance)
                {
                    distance = segmentDistance;
                    closestX = segmentX;
                    closestY = segmentY;
                }
            }
            return true;
        }

        public static List<CenterlineCurveSegment> Flatten(
            CenterlinePrimitiveObservation primitive,
            bool includeSplineApproximation)
        {
            var result = new List<CenterlineCurveSegment>();
            if (primitive == null)
            {
                return result;
            }
            if (string.Equals(primitive.GeometryKind, "line", StringComparison.Ordinal))
            {
                result.Add(LineSegment(
                    primitive.StartX,
                    primitive.StartY,
                    primitive.EndX,
                    primitive.EndY,
                    0,
                    false));
            }
            else if (string.Equals(primitive.GeometryKind, "arc", StringComparison.Ordinal))
            {
                result.Add(ArcSegment(
                    primitive.CenterX,
                    primitive.CenterY,
                    primitive.Radius,
                    primitive.StartAngleRadians,
                    primitive.ArcSweepRadians,
                    0,
                    false));
            }
            else if (string.Equals(primitive.GeometryKind, "circle", StringComparison.Ordinal))
            {
                result.Add(new CenterlineCurveSegment
                {
                    Kind = "circle",
                    CenterX = primitive.CenterX,
                    CenterY = primitive.CenterY,
                    Radius = primitive.Radius,
                    SweepAngle = 2.0 * Math.PI,
                    SegmentIndex = 0
                });
            }
            else if (string.Equals(primitive.GeometryKind, "polyline", StringComparison.Ordinal))
            {
                int segmentCount = primitive.Closed
                    ? primitive.Vertices.Count
                    : primitive.Vertices.Count - 1;
                for (int index = 0; index < segmentCount; index++)
                {
                    CenterlineVertexObservation start = primitive.Vertices[index];
                    CenterlineVertexObservation end =
                        primitive.Vertices[(index + 1) % primitive.Vertices.Count];
                    if (Math.Abs(start.Bulge) <= 1e-12)
                    {
                        result.Add(LineSegment(
                            start.X,
                            start.Y,
                            end.X,
                            end.Y,
                            index,
                            false));
                    }
                    else
                    {
                        result.Add(BulgeArc(start, end, index));
                    }
                }
            }
            else if (includeSplineApproximation
                && string.Equals(primitive.GeometryKind, "spline", StringComparison.Ordinal))
            {
                int segmentCount = primitive.Closed
                    ? primitive.ControlPoints.Count
                    : primitive.ControlPoints.Count - 1;
                for (int index = 0; index < segmentCount; index++)
                {
                    CenterlinePointObservation start = primitive.ControlPoints[index];
                    CenterlinePointObservation end =
                        primitive.ControlPoints[(index + 1) % primitive.ControlPoints.Count];
                    result.Add(LineSegment(
                        start.X,
                        start.Y,
                        end.X,
                        end.Y,
                        index,
                        true));
                }
            }
            return result;
        }

        public static bool TryEndpoints(
            CenterlinePrimitiveObservation primitive,
            out CenterlinePointObservation start,
            out CenterlinePointObservation end)
        {
            start = null;
            end = null;
            List<CenterlineCurveSegment> segments = Flatten(primitive, true);
            if (segments.Count == 0
                || !segments[0].HasEndpoints
                || !segments[segments.Count - 1].HasEndpoints)
            {
                return false;
            }
            start = new CenterlinePointObservation(segments[0].StartX, segments[0].StartY);
            end = new CenterlinePointObservation(
                segments[segments.Count - 1].EndX,
                segments[segments.Count - 1].EndY);
            return true;
        }

        public static bool HaveTangentEndpointJoin(
            CenterlinePrimitiveObservation left,
            CenterlinePrimitiveObservation right,
            double distanceTolerance,
            double angleToleranceDegrees)
        {
            List<CenterlineCurveSegment> leftSegments = Flatten(left, false);
            List<CenterlineCurveSegment> rightSegments = Flatten(right, false);
            if (leftSegments.Count == 0 || rightSegments.Count == 0)
            {
                return false;
            }
            CenterlineCurveSegment[] leftEnds =
            {
                leftSegments[0],
                leftSegments[leftSegments.Count - 1]
            };
            bool[] leftAtStart = { true, false };
            CenterlineCurveSegment[] rightEnds =
            {
                rightSegments[0],
                rightSegments[rightSegments.Count - 1]
            };
            bool[] rightAtStart = { true, false };
            for (int leftIndex = 0; leftIndex < 2; leftIndex++)
            {
                double leftX = leftAtStart[leftIndex]
                    ? leftEnds[leftIndex].StartX
                    : leftEnds[leftIndex].EndX;
                double leftY = leftAtStart[leftIndex]
                    ? leftEnds[leftIndex].StartY
                    : leftEnds[leftIndex].EndY;
                for (int rightIndex = 0; rightIndex < 2; rightIndex++)
                {
                    double rightX = rightAtStart[rightIndex]
                        ? rightEnds[rightIndex].StartX
                        : rightEnds[rightIndex].EndX;
                    double rightY = rightAtStart[rightIndex]
                        ? rightEnds[rightIndex].StartY
                        : rightEnds[rightIndex].EndY;
                    if (Distance(leftX, leftY, rightX, rightY) > distanceTolerance)
                    {
                        continue;
                    }
                    double leftAngle = leftEnds[leftIndex].TangentOrientationDegrees(
                        leftX,
                        leftY);
                    double rightAngle = rightEnds[rightIndex].TangentOrientationDegrees(
                        rightX,
                        rightY);
                    if (ParallelDifference(leftAngle, rightAngle) <= angleToleranceDegrees)
                    {
                        return true;
                    }
                }
            }
            return false;
        }

        public static bool BoundsOverlap(
            IList<CenterlineCurveSegment> left,
            IList<CenterlineCurveSegment> right,
            double tolerance)
        {
            double leftMinX;
            double leftMinY;
            double leftMaxX;
            double leftMaxY;
            Bounds(left, out leftMinX, out leftMinY, out leftMaxX, out leftMaxY);
            double rightMinX;
            double rightMinY;
            double rightMaxX;
            double rightMaxY;
            Bounds(right, out rightMinX, out rightMinY, out rightMaxX, out rightMaxY);
            return leftMaxX + tolerance >= rightMinX
                && rightMaxX + tolerance >= leftMinX
                && leftMaxY + tolerance >= rightMinY
                && rightMaxY + tolerance >= leftMinY;
        }

        public static IList<CenterlineRawIntersection> Intersections(
            CenterlineCurveSegment left,
            CenterlineCurveSegment right,
            double tolerance)
        {
            if (!BoundsOverlap(
                new[] { left },
                new[] { right },
                tolerance))
            {
                return new List<CenterlineRawIntersection>();
            }
            if (!left.IsRadial && !right.IsRadial)
            {
                return LineLine(left, right, tolerance);
            }
            if (!left.IsRadial)
            {
                return LineRadial(left, right, tolerance);
            }
            if (!right.IsRadial)
            {
                IList<CenterlineRawIntersection> swapped = LineRadial(right, left, tolerance);
                foreach (CenterlineRawIntersection raw in swapped)
                {
                    SwapSides(raw);
                }
                return swapped;
            }
            return RadialRadial(left, right, tolerance);
        }

        public static bool PointOnLineSegment(
            CenterlineCurveSegment line,
            double x,
            double y,
            double tolerance)
        {
            double closestX;
            double closestY;
            double distance;
            ClosestPointOnLine(line, x, y, out closestX, out closestY, out distance);
            return distance <= tolerance;
        }

        public static double NormalizePositive(double value)
        {
            double full = 2.0 * Math.PI;
            value %= full;
            return value < 0 ? value + full : value;
        }

        public static double Distance(double x1, double y1, double x2, double y2)
        {
            double dx = x2 - x1;
            double dy = y2 - y1;
            return Math.Sqrt(dx * dx + dy * dy);
        }

        static CenterlineCurveSegment LineSegment(
            double startX,
            double startY,
            double endX,
            double endY,
            int index,
            bool approximate)
        {
            return new CenterlineCurveSegment
            {
                Kind = "line",
                StartX = startX,
                StartY = startY,
                EndX = endX,
                EndY = endY,
                SegmentIndex = index,
                Approximate = approximate
            };
        }

        static CenterlineCurveSegment ArcSegment(
            double centerX,
            double centerY,
            double radius,
            double startAngle,
            double sweepAngle,
            int index,
            bool approximate)
        {
            return new CenterlineCurveSegment
            {
                Kind = "arc",
                CenterX = centerX,
                CenterY = centerY,
                Radius = radius,
                StartAngle = startAngle,
                SweepAngle = sweepAngle,
                StartX = centerX + radius * Math.Cos(startAngle),
                StartY = centerY + radius * Math.Sin(startAngle),
                EndX = centerX + radius * Math.Cos(startAngle + sweepAngle),
                EndY = centerY + radius * Math.Sin(startAngle + sweepAngle),
                SegmentIndex = index,
                Approximate = approximate
            };
        }

        static CenterlineCurveSegment BulgeArc(
            CenterlineVertexObservation start,
            CenterlineVertexObservation end,
            int index)
        {
            double chordX = end.X - start.X;
            double chordY = end.Y - start.Y;
            double chord = Math.Sqrt(chordX * chordX + chordY * chordY);
            if (chord <= 1e-12)
            {
                return LineSegment(start.X, start.Y, end.X, end.Y, index, false);
            }
            double sweep = 4.0 * Math.Atan(start.Bulge);
            double midpointX = (start.X + end.X) * 0.5;
            double midpointY = (start.Y + end.Y) * 0.5;
            double offset = chord / (2.0 * Math.Tan(sweep * 0.5));
            double leftX = -chordY / chord;
            double leftY = chordX / chord;
            double centerX = midpointX + leftX * offset;
            double centerY = midpointY + leftY * offset;
            double radius = Distance(centerX, centerY, start.X, start.Y);
            double startAngle = Math.Atan2(start.Y - centerY, start.X - centerX);
            return ArcSegment(centerX, centerY, radius, startAngle, sweep, index, false);
        }

        static void ClosestPoint(
            CenterlineCurveSegment segment,
            double x,
            double y,
            out double closestX,
            out double closestY,
            out double distance)
        {
            if (!segment.IsRadial)
            {
                ClosestPointOnLine(segment, x, y, out closestX, out closestY, out distance);
                return;
            }
            double angle = Math.Atan2(y - segment.CenterY, x - segment.CenterX);
            if (string.Equals(segment.Kind, "circle", StringComparison.Ordinal)
                || segment.ContainsAngle(angle, 0))
            {
                closestX = segment.CenterX + segment.Radius * Math.Cos(angle);
                closestY = segment.CenterY + segment.Radius * Math.Sin(angle);
                distance = Distance(x, y, closestX, closestY);
                return;
            }
            double startDistance = Distance(x, y, segment.StartX, segment.StartY);
            double endDistance = Distance(x, y, segment.EndX, segment.EndY);
            if (startDistance <= endDistance)
            {
                closestX = segment.StartX;
                closestY = segment.StartY;
                distance = startDistance;
            }
            else
            {
                closestX = segment.EndX;
                closestY = segment.EndY;
                distance = endDistance;
            }
        }

        static void ClosestPointOnLine(
            CenterlineCurveSegment line,
            double x,
            double y,
            out double closestX,
            out double closestY,
            out double distance)
        {
            double dx = line.EndX - line.StartX;
            double dy = line.EndY - line.StartY;
            double lengthSquared = dx * dx + dy * dy;
            double position = lengthSquared <= 0
                ? 0
                : ((x - line.StartX) * dx + (y - line.StartY) * dy) / lengthSquared;
            position = Math.Max(0, Math.Min(1, position));
            closestX = line.StartX + position * dx;
            closestY = line.StartY + position * dy;
            distance = Distance(x, y, closestX, closestY);
        }

        static IList<CenterlineRawIntersection> LineLine(
            CenterlineCurveSegment left,
            CenterlineCurveSegment right,
            double tolerance)
        {
            var result = new List<CenterlineRawIntersection>();
            double rx = left.EndX - left.StartX;
            double ry = left.EndY - left.StartY;
            double sx = right.EndX - right.StartX;
            double sy = right.EndY - right.StartY;
            double denominator = Cross(rx, ry, sx, sy);
            double qpx = right.StartX - left.StartX;
            double qpy = right.StartY - left.StartY;
            if (Math.Abs(denominator) <= 1e-12)
            {
                if (Math.Abs(Cross(qpx, qpy, rx, ry)) > tolerance * Math.Max(1, Math.Sqrt(rx * rx + ry * ry)))
                {
                    return result;
                }
                var candidates = new List<CenterlinePointObservation>();
                AddIfOnBoth(candidates, left, right, left.StartX, left.StartY, tolerance);
                AddIfOnBoth(candidates, left, right, left.EndX, left.EndY, tolerance);
                AddIfOnBoth(candidates, left, right, right.StartX, right.StartY, tolerance);
                AddIfOnBoth(candidates, left, right, right.EndX, right.EndY, tolerance);
                if (candidates.Count == 1)
                {
                    result.Add(RawAt(left, right, candidates[0].X, candidates[0].Y, tolerance));
                }
                return result;
            }
            double t = Cross(qpx, qpy, sx, sy) / denominator;
            double u = Cross(qpx, qpy, rx, ry) / denominator;
            double leftLength = Math.Sqrt(rx * rx + ry * ry);
            double rightLength = Math.Sqrt(sx * sx + sy * sy);
            double leftParameterTolerance = tolerance / Math.Max(1, leftLength);
            double rightParameterTolerance = tolerance / Math.Max(1, rightLength);
            if (t < -leftParameterTolerance
                || t > 1 + leftParameterTolerance
                || u < -rightParameterTolerance
                || u > 1 + rightParameterTolerance)
            {
                return result;
            }
            double x = left.StartX + t * rx;
            double y = left.StartY + t * ry;
            result.Add(RawAt(left, right, x, y, tolerance));
            return result;
        }

        static IList<CenterlineRawIntersection> LineRadial(
            CenterlineCurveSegment line,
            CenterlineCurveSegment radial,
            double tolerance)
        {
            var result = new List<CenterlineRawIntersection>();
            double dx = line.EndX - line.StartX;
            double dy = line.EndY - line.StartY;
            double fx = line.StartX - radial.CenterX;
            double fy = line.StartY - radial.CenterY;
            double a = dx * dx + dy * dy;
            if (a <= 1e-20)
            {
                return result;
            }
            double b = 2.0 * (fx * dx + fy * dy);
            double c = fx * fx + fy * fy - radial.Radius * radial.Radius;
            double discriminant = b * b - 4.0 * a * c;
            double discriminantTolerance = tolerance * tolerance * Math.Max(1, a);
            if (discriminant < -discriminantTolerance)
            {
                return result;
            }
            discriminant = Math.Max(0, discriminant);
            double root = Math.Sqrt(discriminant);
            AddLineRadialRoot(result, line, radial, (-b - root) / (2.0 * a), tolerance);
            if (root > tolerance)
            {
                AddLineRadialRoot(result, line, radial, (-b + root) / (2.0 * a), tolerance);
            }
            return result;
        }

        static IList<CenterlineRawIntersection> RadialRadial(
            CenterlineCurveSegment left,
            CenterlineCurveSegment right,
            double tolerance)
        {
            var result = new List<CenterlineRawIntersection>();
            double dx = right.CenterX - left.CenterX;
            double dy = right.CenterY - left.CenterY;
            double distance = Math.Sqrt(dx * dx + dy * dy);
            if (distance <= tolerance
                && Math.Abs(left.Radius - right.Radius) <= tolerance)
            {
                return result;
            }
            if (distance > left.Radius + right.Radius + tolerance
                || distance < Math.Abs(left.Radius - right.Radius) - tolerance
                || distance <= 1e-20)
            {
                return result;
            }
            double along = (left.Radius * left.Radius
                - right.Radius * right.Radius
                + distance * distance) / (2.0 * distance);
            double heightSquared = left.Radius * left.Radius - along * along;
            if (heightSquared < -tolerance * tolerance)
            {
                return result;
            }
            double height = Math.Sqrt(Math.Max(0, heightSquared));
            double baseX = left.CenterX + along * dx / distance;
            double baseY = left.CenterY + along * dy / distance;
            double offsetX = -dy * height / distance;
            double offsetY = dx * height / distance;
            AddRadialPoint(result, left, right, baseX + offsetX, baseY + offsetY, tolerance);
            if (height > tolerance)
            {
                AddRadialPoint(result, left, right, baseX - offsetX, baseY - offsetY, tolerance);
            }
            return result;
        }

        static void AddLineRadialRoot(
            IList<CenterlineRawIntersection> result,
            CenterlineCurveSegment line,
            CenterlineCurveSegment radial,
            double position,
            double tolerance)
        {
            double length = Distance(line.StartX, line.StartY, line.EndX, line.EndY);
            double parameterTolerance = tolerance / Math.Max(1, length);
            if (position < -parameterTolerance || position > 1 + parameterTolerance)
            {
                return;
            }
            double x = line.StartX + position * (line.EndX - line.StartX);
            double y = line.StartY + position * (line.EndY - line.StartY);
            if (!radial.ContainsPointOnCurve(x, y, tolerance))
            {
                return;
            }
            AddUniqueRaw(result, RawAt(line, radial, x, y, tolerance), tolerance);
        }

        static void AddRadialPoint(
            IList<CenterlineRawIntersection> result,
            CenterlineCurveSegment left,
            CenterlineCurveSegment right,
            double x,
            double y,
            double tolerance)
        {
            if (left.ContainsPointOnCurve(x, y, tolerance)
                && right.ContainsPointOnCurve(x, y, tolerance))
            {
                AddUniqueRaw(result, RawAt(left, right, x, y, tolerance), tolerance);
            }
        }

        static CenterlineRawIntersection RawAt(
            CenterlineCurveSegment left,
            CenterlineCurveSegment right,
            double x,
            double y,
            double tolerance)
        {
            return new CenterlineRawIntersection
            {
                X = x,
                Y = y,
                LeftOrientation = left.TangentOrientationDegrees(x, y),
                RightOrientation = right.TangentOrientationDegrees(x, y),
                LeftEndpoint = left.IsEndpoint(x, y, tolerance),
                RightEndpoint = right.IsEndpoint(x, y, tolerance)
            };
        }

        static void AddIfOnBoth(
            IList<CenterlinePointObservation> points,
            CenterlineCurveSegment left,
            CenterlineCurveSegment right,
            double x,
            double y,
            double tolerance)
        {
            if (!PointOnLineSegment(left, x, y, tolerance)
                || !PointOnLineSegment(right, x, y, tolerance))
            {
                return;
            }
            foreach (CenterlinePointObservation existing in points)
            {
                if (Distance(existing.X, existing.Y, x, y) <= tolerance)
                {
                    return;
                }
            }
            points.Add(new CenterlinePointObservation(x, y));
        }

        static void AddUniqueRaw(
            IList<CenterlineRawIntersection> values,
            CenterlineRawIntersection value,
            double tolerance)
        {
            foreach (CenterlineRawIntersection existing in values)
            {
                if (Distance(existing.X, existing.Y, value.X, value.Y) <= tolerance)
                {
                    return;
                }
            }
            values.Add(value);
        }

        static void Bounds(
            IList<CenterlineCurveSegment> segments,
            out double minX,
            out double minY,
            out double maxX,
            out double maxY)
        {
            minX = double.MaxValue;
            minY = double.MaxValue;
            maxX = double.MinValue;
            maxY = double.MinValue;
            foreach (CenterlineCurveSegment segment in segments)
            {
                double segmentMinX;
                double segmentMinY;
                double segmentMaxX;
                double segmentMaxY;
                segment.Bounds(out segmentMinX, out segmentMinY, out segmentMaxX, out segmentMaxY);
                minX = Math.Min(minX, segmentMinX);
                minY = Math.Min(minY, segmentMinY);
                maxX = Math.Max(maxX, segmentMaxX);
                maxY = Math.Max(maxY, segmentMaxY);
            }
        }

        static double Cross(double x1, double y1, double x2, double y2)
        {
            return x1 * y2 - y1 * x2;
        }

        static double ParallelDifference(double left, double right)
        {
            double value = Math.Abs(left - right) % 180.0;
            return Math.Min(value, 180.0 - value);
        }

        static void SwapSides(CenterlineRawIntersection raw)
        {
            double orientation = raw.LeftOrientation;
            raw.LeftOrientation = raw.RightOrientation;
            raw.RightOrientation = orientation;
            bool endpoint = raw.LeftEndpoint;
            raw.LeftEndpoint = raw.RightEndpoint;
            raw.RightEndpoint = endpoint;
        }
    }

    internal sealed class CenterlineIntersectionClusters
    {
        readonly string ownerScope;
        readonly string ownerBlockName;
        readonly double tolerance;
        readonly double tangentTolerance;
        readonly Dictionary<string, List<CenterlineIntersectionCluster>> cells;
        readonly List<CenterlineIntersectionCluster> all;

        public CenterlineIntersectionClusters(
            string ownerScope,
            string ownerBlockName,
            double tolerance,
            double tangentTolerance)
        {
            this.ownerScope = ownerScope ?? "";
            this.ownerBlockName = ownerBlockName ?? "";
            this.tolerance = tolerance;
            this.tangentTolerance = tangentTolerance;
            cells = new Dictionary<string, List<CenterlineIntersectionCluster>>(
                StringComparer.Ordinal);
            all = new List<CenterlineIntersectionCluster>();
        }

        public void Add(CenterlineRawIntersection raw)
        {
            long cellX = Cell(raw.X);
            long cellY = Cell(raw.Y);
            CenterlineIntersectionCluster closest = null;
            double closestDistance = double.MaxValue;
            for (long x = cellX - 1; x <= cellX + 1; x++)
            {
                for (long y = cellY - 1; y <= cellY + 1; y++)
                {
                    List<CenterlineIntersectionCluster> candidates;
                    if (!cells.TryGetValue(CellKey(x, y), out candidates))
                    {
                        continue;
                    }
                    foreach (CenterlineIntersectionCluster candidate in candidates)
                    {
                        double distance = CenterlineGeometryMath.Distance(
                            candidate.X,
                            candidate.Y,
                            raw.X,
                            raw.Y);
                        if (distance <= tolerance && distance < closestDistance)
                        {
                            closest = candidate;
                            closestDistance = distance;
                        }
                    }
                }
            }
            if (closest == null)
            {
                closest = new CenterlineIntersectionCluster(raw);
                all.Add(closest);
                string key = CellKey(cellX, cellY);
                List<CenterlineIntersectionCluster> bucket;
                if (!cells.TryGetValue(key, out bucket))
                {
                    bucket = new List<CenterlineIntersectionCluster>();
                    cells.Add(key, bucket);
                }
                bucket.Add(closest);
            }
            else
            {
                closest.Add(raw);
            }
        }

        public IList<CenterlineIntersection> Build()
        {
            var result = new List<CenterlineIntersection>();
            foreach (CenterlineIntersectionCluster cluster in all)
            {
                result.Add(cluster.Build(
                    ownerScope,
                    ownerBlockName,
                    tangentTolerance));
            }
            return result;
        }

        long Cell(double value)
        {
            return (long)Math.Floor(value / tolerance);
        }

        static string CellKey(long x, long y)
        {
            return x.ToString(CultureInfo.InvariantCulture)
                + ":" + y.ToString(CultureInfo.InvariantCulture);
        }
    }

    internal sealed class CenterlineIntersectionCluster
    {
        double sumX;
        double sumY;
        int pointCount;
        bool allEndpointJoins;
        readonly List<string> handles;
        readonly List<string> kinds;
        readonly List<double> angles;

        public CenterlineIntersectionCluster(CenterlineRawIntersection raw)
        {
            handles = new List<string>();
            kinds = new List<string>();
            angles = new List<double>();
            allEndpointJoins = true;
            Add(raw);
        }

        public double X { get { return sumX / pointCount; } }
        public double Y { get { return sumY / pointCount; } }

        public void Add(CenterlineRawIntersection raw)
        {
            sumX += raw.X;
            sumY += raw.Y;
            pointCount++;
            AddUnique(handles, raw.LeftHandle);
            AddUnique(handles, raw.RightHandle);
            AddUnique(kinds, raw.LeftGeometryKind);
            AddUnique(kinds, raw.RightGeometryKind);
            AddUniqueAngle(ParallelDifference(raw.LeftOrientation, raw.RightOrientation));
            allEndpointJoins = allEndpointJoins && raw.LeftEndpoint && raw.RightEndpoint;
        }

        public CenterlineIntersection Build(
            string ownerScope,
            string ownerBlockName,
            double tangentTolerance)
        {
            handles.Sort(StringComparer.OrdinalIgnoreCase);
            kinds.Sort(StringComparer.Ordinal);
            angles.Sort();
            string type;
            if (handles.Count >= 3)
            {
                type = "multiway";
            }
            else
            {
                double smallest = angles.Count == 0 ? 0 : angles[0];
                if (allEndpointJoins)
                {
                    type = smallest <= tangentTolerance ? "tangent_join" : "corner_join";
                }
                else
                {
                    type = smallest <= tangentTolerance ? "tangent" : "crossing";
                }
            }
            return new CenterlineIntersection(
                ownerScope,
                ownerBlockName,
                X,
                Y,
                type,
                allEndpointJoins,
                handles,
                kinds,
                angles);
        }

        static void AddUnique(IList<string> values, string value)
        {
            foreach (string existing in values)
            {
                if (string.Equals(existing, value, StringComparison.OrdinalIgnoreCase))
                {
                    return;
                }
            }
            values.Add(value ?? "");
        }

        void AddUniqueAngle(double value)
        {
            foreach (double existing in angles)
            {
                if (Math.Abs(existing - value) <= 0.001)
                {
                    return;
                }
            }
            angles.Add(value);
        }

        static double ParallelDifference(double left, double right)
        {
            double value = Math.Abs(left - right) % 180.0;
            value = Math.Min(value, 180.0 - value);
            return Math.Min(value, 90.0);
        }
    }
}
