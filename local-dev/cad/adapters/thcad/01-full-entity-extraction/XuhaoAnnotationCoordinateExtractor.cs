using System;
using System.Collections.Generic;
using Teigha.DatabaseServices;
using Teigha.Geometry;

namespace Shb.Thcad.Extractor
{
    internal sealed class XuhaoAnnotationCoordinates
    {
        public XuhaoAnnotationCoordinates(Point3d? pointingPoint, Point3d numberPoint)
        {
            PointingPoint = pointingPoint;
            NumberPoint = numberPoint;
        }

        public Point3d? PointingPoint { get; private set; }
        public Point3d NumberPoint { get; private set; }

        public double[] PointingPosition
        {
            get
            {
                return PointingPoint.HasValue
                    ? new[]
                    {
                        PointingPoint.Value.X,
                        PointingPoint.Value.Y,
                        PointingPoint.Value.Z
                    }
                    : null;
            }
        }

        public double[] NumberPosition
        {
            get
            {
                return new[] { NumberPoint.X, NumberPoint.Y, NumberPoint.Z };
            }
        }
    }

    internal static class XuhaoAnnotationCoordinateExtractor
    {
        sealed class CirclePart
        {
            public CirclePart(Point3d center, double radius)
            {
                Center = center;
                Radius = radius;
            }

            public Point3d Center { get; private set; }
            public double Radius { get; private set; }
        }

        sealed class LinePart
        {
            public LinePart(Point3d start, Point3d end)
            {
                Start = start;
                End = end;
            }

            public Point3d Start { get; private set; }
            public Point3d End { get; private set; }
        }

        sealed class CenterGroup
        {
            public CenterGroup(Point3d center)
            {
                Center = center;
                Count = 1;
            }

            public Point3d Center { get; private set; }
            public int Count { get; set; }
        }

        public static XuhaoAnnotationCoordinates Extract(Entity entity)
        {
            if (entity == null || !IsXuhaoEntity(entity))
            {
                return null;
            }

            var exploded = new DBObjectCollection();
            try
            {
                entity.ExplodeGeometry(exploded);

                var circles = new List<CirclePart>();
                var lines = new List<LinePart>();
                foreach (DBObject child in exploded)
                {
                    var circle = child as Circle;
                    if (circle != null)
                    {
                        circles.Add(new CirclePart(circle.Center, circle.Radius));
                        continue;
                    }

                    var line = child as Line;
                    if (line != null)
                    {
                        lines.Add(new LinePart(line.StartPoint, line.EndPoint));
                    }
                }

                if (circles.Count == 0)
                {
                    return null;
                }

                CirclePart numberCircle = circles[0];
                for (int index = 1; index < circles.Count; index++)
                {
                    if (circles[index].Radius > numberCircle.Radius)
                    {
                        numberCircle = circles[index];
                    }
                }

                double tolerance = Math.Max(
                    0.000001,
                    Math.Max(1.0, numberCircle.Radius) * 0.000001);
                var targetGroups = new List<CenterGroup>();
                foreach (CirclePart circle in circles)
                {
                    if (SamePoint(circle.Center, numberCircle.Center, tolerance))
                    {
                        continue;
                    }

                    CenterGroup group = null;
                    foreach (CenterGroup existing in targetGroups)
                    {
                        if (SamePoint(existing.Center, circle.Center, tolerance))
                        {
                            group = existing;
                            break;
                        }
                    }

                    if (group == null)
                    {
                        targetGroups.Add(new CenterGroup(circle.Center));
                    }
                    else
                    {
                        group.Count++;
                    }
                }

                CenterGroup target = null;
                foreach (CenterGroup group in targetGroups)
                {
                    if (group.Count < 2 || !TouchesLineEndpoint(group.Center, lines, tolerance))
                    {
                        continue;
                    }
                    if (target == null || group.Count > target.Count)
                    {
                        target = group;
                    }
                }

                return new XuhaoAnnotationCoordinates(
                    target == null ? (Point3d?)null : target.Center,
                    numberCircle.Center);
            }
            catch
            {
                return null;
            }
            finally
            {
                foreach (DBObject child in exploded)
                {
                    if (child != null)
                    {
                        child.Dispose();
                    }
                }
            }
        }

        static bool IsXuhaoEntity(Entity entity)
        {
            try
            {
                return string.Equals(
                    entity.GetRXClass().Name,
                    "TH_XuHaoEntity",
                    StringComparison.Ordinal);
            }
            catch
            {
                return false;
            }
        }

        static bool TouchesLineEndpoint(
            Point3d point,
            IList<LinePart> lines,
            double tolerance)
        {
            foreach (LinePart line in lines)
            {
                if (SamePoint(point, line.Start, tolerance)
                    || SamePoint(point, line.End, tolerance))
                {
                    return true;
                }
            }
            return false;
        }

        static bool SamePoint(Point3d left, Point3d right, double tolerance)
        {
            double dx = left.X - right.X;
            double dy = left.Y - right.Y;
            double dz = left.Z - right.Z;
            return dx * dx + dy * dy + dz * dz <= tolerance * tolerance;
        }
    }
}
