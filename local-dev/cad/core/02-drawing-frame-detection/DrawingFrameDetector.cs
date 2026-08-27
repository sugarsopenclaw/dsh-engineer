using System;
using System.Collections.Generic;

namespace Shb.Cad.Core
{
    // Host-neutral line input. THCAD, extracted JSON, and future CAD adapters
    // can all reuse the same frame geometry algorithm.
    public sealed class DrawingFrameSegment
    {
        public DrawingFrameSegment(
            string handle,
            string layer,
            double startX,
            double startY,
            double endX,
            double endY)
        {
            Handle = handle ?? "";
            Layer = layer ?? "";
            StartX = startX;
            StartY = startY;
            EndX = endX;
            EndY = endY;
        }

        public string Handle { get; private set; }
        public string Layer { get; private set; }
        public double StartX { get; private set; }
        public double StartY { get; private set; }
        public double EndX { get; private set; }
        public double EndY { get; private set; }

        internal double MinX { get { return Math.Min(StartX, EndX); } }
        internal double MaxX { get { return Math.Max(StartX, EndX); } }
        internal double MinY { get { return Math.Min(StartY, EndY); } }
        internal double MaxY { get { return Math.Max(StartY, EndY); } }
        internal double MidX { get { return (StartX + EndX) * 0.5; } }
        internal double MidY { get { return (StartY + EndY) * 0.5; } }
        internal double Length
        {
            get
            {
                double dx = EndX - StartX;
                double dy = EndY - StartY;
                return Math.Sqrt(dx * dx + dy * dy);
            }
        }
    }

    public sealed class DrawingFrameDetectorOptions
    {
        public DrawingFrameDetectorOptions()
        {
            FrameLayerNames = new List<string> { "图框层" };
            CoordinateTolerance = 0.001;
            AxisAlignmentTolerance = 0.000001;
            MinimumWidth = 1.0;
            MinimumHeight = 1.0;
        }

        public IList<string> FrameLayerNames { get; set; }
        public double CoordinateTolerance { get; set; }
        public double AxisAlignmentTolerance { get; set; }
        public double MinimumWidth { get; set; }
        public double MinimumHeight { get; set; }

        internal bool AcceptsLayer(string layer)
        {
            if (FrameLayerNames == null || FrameLayerNames.Count == 0)
            {
                return false;
            }

            foreach (string name in FrameLayerNames)
            {
                if (string.Equals(name, layer, StringComparison.OrdinalIgnoreCase))
                {
                    return true;
                }
            }

            return false;
        }
    }

    public sealed class DrawingFrameCandidate
    {
        internal DrawingFrameCandidate(
            double minX,
            double minY,
            double maxX,
            double maxY,
            DrawingFrameSegment left,
            DrawingFrameSegment right,
            DrawingFrameSegment bottom,
            DrawingFrameSegment top)
        {
            MinX = minX;
            MinY = minY;
            MaxX = maxX;
            MaxY = maxY;
            Left = left;
            Right = right;
            Bottom = bottom;
            Top = top;
            IsOutermost = true;
        }

        public string Id { get; internal set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }
        public double Width { get { return MaxX - MinX; } }
        public double Height { get { return MaxY - MinY; } }
        public double Area { get { return Width * Height; } }
        public bool IsOutermost { get; internal set; }
        public DrawingFrameSegment Left { get; private set; }
        public DrawingFrameSegment Right { get; private set; }
        public DrawingFrameSegment Bottom { get; private set; }
        public DrawingFrameSegment Top { get; private set; }

        internal Dictionary<string, object> ToMap()
        {
            return Map(
                "id", Id,
                "method", "axis_aligned_four_lines",
                "is_outermost", IsOutermost,
                "outermost_scope", "configured_layer_candidates",
                "min", new[] { MinX, MinY },
                "max", new[] { MaxX, MaxY },
                "width", Width,
                "height", Height,
                "area", Area,
                "layers", UniqueLayers(),
                "edge_handles", Map(
                    "left", Left.Handle,
                    "right", Right.Handle,
                    "bottom", Bottom.Handle,
                    "top", Top.Handle));
        }

        List<string> UniqueLayers()
        {
            var layers = new List<string>();
            AddUnique(layers, Left.Layer);
            AddUnique(layers, Right.Layer);
            AddUnique(layers, Bottom.Layer);
            AddUnique(layers, Top.Layer);
            return layers;
        }

        static void AddUnique(List<string> values, string value)
        {
            foreach (string existing in values)
            {
                if (string.Equals(existing, value, StringComparison.OrdinalIgnoreCase))
                {
                    return;
                }
            }
            values.Add(value);
        }

        static Dictionary<string, object> Map(params object[] pairs)
        {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            for (int i = 0; i < pairs.Length; i += 2)
            {
                result[(string)pairs[i]] = pairs[i + 1];
            }
            return result;
        }
    }

    public sealed class DrawingFrameDetectionResult
    {
        internal DrawingFrameDetectionResult()
        {
            Candidates = new List<DrawingFrameCandidate>();
            FrameLayerNames = new List<string>();
        }

        public int SourceLineCount { get; internal set; }
        public int EligibleLayerLineCount { get; internal set; }
        public int HorizontalLineCount { get; internal set; }
        public int VerticalLineCount { get; internal set; }
        public int RejectedDegenerateCount { get; internal set; }
        public int RejectedNonAxisAlignedCount { get; internal set; }
        public IList<string> FrameLayerNames { get; internal set; }
        public double CoordinateTolerance { get; internal set; }
        public double AxisAlignmentTolerance { get; internal set; }
        public double MinimumWidth { get; internal set; }
        public double MinimumHeight { get; internal set; }
        public IList<DrawingFrameCandidate> Candidates { get; private set; }

        public IList<DrawingFrameCandidate> OutermostFrames
        {
            get
            {
                var outermost = new List<DrawingFrameCandidate>();
                foreach (DrawingFrameCandidate candidate in Candidates)
                {
                    if (candidate.IsOutermost)
                    {
                        outermost.Add(candidate);
                    }
                }
                return outermost;
            }
        }

        public Dictionary<string, object> ToMap()
        {
            var frames = new List<Dictionary<string, object>>();
            var outermostIds = new List<string>();
            foreach (DrawingFrameCandidate candidate in Candidates)
            {
                frames.Add(candidate.ToMap());
                if (candidate.IsOutermost)
                {
                    outermostIds.Add(candidate.Id);
                }
            }

            return Map(
                "schema_version", "1",
                "detector", "drawing_frame_detector",
                "detector_version", "1",
                "method", "axis_aligned_four_lines",
                "options", Map(
                    "frame_layer_names", FrameLayerNames,
                    "coordinate_tolerance", CoordinateTolerance,
                    "axis_alignment_tolerance", AxisAlignmentTolerance,
                    "minimum_width", MinimumWidth,
                    "minimum_height", MinimumHeight),
                "limits", new[]
                {
                    "model_space_lines_only",
                    "configured_layers_only",
                    "axis_aligned_only",
                    "one_line_per_side",
                    "outermost_is_relative_to_configured_layer_candidates"
                },
                "source_line_count", SourceLineCount,
                "eligible_layer_line_count", EligibleLayerLineCount,
                "horizontal_line_count", HorizontalLineCount,
                "vertical_line_count", VerticalLineCount,
                "rejected_degenerate_count", RejectedDegenerateCount,
                "rejected_non_axis_aligned_count", RejectedNonAxisAlignedCount,
                "candidate_count", Candidates.Count,
                "outermost_frame_count", outermostIds.Count,
                "outermost_frame_ids", outermostIds,
                "frames", frames);
        }

        static Dictionary<string, object> Map(params object[] pairs)
        {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            for (int i = 0; i < pairs.Length; i += 2)
            {
                result[(string)pairs[i]] = pairs[i + 1];
            }
            return result;
        }
    }

    public static class DrawingFrameDetector
    {
        public static DrawingFrameDetectionResult Detect(
            IList<DrawingFrameSegment> sourceLines,
            DrawingFrameDetectorOptions options = null)
        {
            if (sourceLines == null)
            {
                throw new ArgumentNullException("sourceLines");
            }

            options = options ?? new DrawingFrameDetectorOptions();
            ValidateOptions(options);

            var result = new DrawingFrameDetectionResult();
            result.SourceLineCount = sourceLines.Count;
            result.FrameLayerNames = new List<string>(options.FrameLayerNames);
            result.CoordinateTolerance = options.CoordinateTolerance;
            result.AxisAlignmentTolerance = options.AxisAlignmentTolerance;
            result.MinimumWidth = options.MinimumWidth;
            result.MinimumHeight = options.MinimumHeight;
            var horizontal = new List<DrawingFrameSegment>();
            var vertical = new List<DrawingFrameSegment>();

            foreach (DrawingFrameSegment line in sourceLines)
            {
                if (line == null || !options.AcceptsLayer(line.Layer))
                {
                    continue;
                }

                result.EligibleLayerLineCount++;
                double length = line.Length;
                if (length <= options.CoordinateTolerance)
                {
                    result.RejectedDegenerateCount++;
                    continue;
                }

                double dx = Math.Abs(line.EndX - line.StartX);
                double dy = Math.Abs(line.EndY - line.StartY);
                double axisTolerance = Math.Max(
                    options.CoordinateTolerance,
                    length * options.AxisAlignmentTolerance);
                if (dy <= axisTolerance)
                {
                    horizontal.Add(line);
                }
                else if (dx <= axisTolerance)
                {
                    vertical.Add(line);
                }
                else
                {
                    result.RejectedNonAxisAlignedCount++;
                }
            }

            result.HorizontalLineCount = horizontal.Count;
            result.VerticalLineCount = vertical.Count;
            FindRectangles(horizontal, vertical, options, result);
            return result;
        }

        static void FindRectangles(
            List<DrawingFrameSegment> horizontal,
            List<DrawingFrameSegment> vertical,
            DrawingFrameDetectorOptions options,
            DrawingFrameDetectionResult result)
        {
            var seenBounds = new HashSet<string>(StringComparer.Ordinal);
            for (int h1 = 0; h1 < horizontal.Count; h1++)
            {
                for (int h2 = h1 + 1; h2 < horizontal.Count; h2++)
                {
                    DrawingFrameSegment bottom = horizontal[h1].MidY <= horizontal[h2].MidY
                        ? horizontal[h1]
                        : horizontal[h2];
                    DrawingFrameSegment top = ReferenceEquals(bottom, horizontal[h1])
                        ? horizontal[h2]
                        : horizontal[h1];
                    double minY = bottom.MidY;
                    double maxY = top.MidY;
                    if (maxY - minY < options.MinimumHeight)
                    {
                        continue;
                    }

                    for (int v1 = 0; v1 < vertical.Count; v1++)
                    {
                        for (int v2 = v1 + 1; v2 < vertical.Count; v2++)
                        {
                            DrawingFrameSegment left = vertical[v1].MidX <= vertical[v2].MidX
                                ? vertical[v1]
                                : vertical[v2];
                            DrawingFrameSegment right = ReferenceEquals(left, vertical[v1])
                                ? vertical[v2]
                                : vertical[v1];
                            double minX = left.MidX;
                            double maxX = right.MidX;
                            if (maxX - minX < options.MinimumWidth)
                            {
                                continue;
                            }

                            if (!CoversX(bottom, minX, maxX, options.CoordinateTolerance)
                                || !CoversX(top, minX, maxX, options.CoordinateTolerance)
                                || !CoversY(left, minY, maxY, options.CoordinateTolerance)
                                || !CoversY(right, minY, maxY, options.CoordinateTolerance))
                            {
                                continue;
                            }

                            string key = BoundsKey(minX, minY, maxX, maxY, options.CoordinateTolerance);
                            if (!seenBounds.Add(key))
                            {
                                continue;
                            }

                            result.Candidates.Add(new DrawingFrameCandidate(
                                minX,
                                minY,
                                maxX,
                                maxY,
                                left,
                                right,
                                bottom,
                                top));
                        }
                    }
                }
            }

            var ordered = (List<DrawingFrameCandidate>)result.Candidates;
            ordered.Sort(CompareCandidates);
            MarkOutermost(ordered, options.CoordinateTolerance);
            for (int i = 0; i < ordered.Count; i++)
            {
                ordered[i].Id = "frame-" + (i + 1);
            }
        }

        static void ValidateOptions(DrawingFrameDetectorOptions options)
        {
            if (options.FrameLayerNames == null || options.FrameLayerNames.Count == 0)
            {
                throw new ArgumentException("At least one frame layer name is required.", "FrameLayerNames");
            }
            if (options.CoordinateTolerance <= 0)
            {
                throw new ArgumentOutOfRangeException("CoordinateTolerance");
            }
            if (options.AxisAlignmentTolerance < 0)
            {
                throw new ArgumentOutOfRangeException("AxisAlignmentTolerance");
            }
            if (options.MinimumWidth <= 0 || options.MinimumHeight <= 0)
            {
                throw new ArgumentOutOfRangeException("MinimumWidth/MinimumHeight");
            }
        }

        static bool CoversX(DrawingFrameSegment line, double minX, double maxX, double tolerance)
        {
            return line.MinX <= minX + tolerance && line.MaxX >= maxX - tolerance;
        }

        static bool CoversY(DrawingFrameSegment line, double minY, double maxY, double tolerance)
        {
            return line.MinY <= minY + tolerance && line.MaxY >= maxY - tolerance;
        }

        static string BoundsKey(
            double minX,
            double minY,
            double maxX,
            double maxY,
            double tolerance)
        {
            return Quantize(minX, tolerance) + ":"
                + Quantize(minY, tolerance) + ":"
                + Quantize(maxX, tolerance) + ":"
                + Quantize(maxY, tolerance);
        }

        static long Quantize(double value, double tolerance)
        {
            return (long)Math.Round(value / tolerance, MidpointRounding.AwayFromZero);
        }

        static int CompareCandidates(DrawingFrameCandidate left, DrawingFrameCandidate right)
        {
            int area = right.Area.CompareTo(left.Area);
            if (area != 0)
            {
                return area;
            }
            int x = left.MinX.CompareTo(right.MinX);
            return x != 0 ? x : left.MinY.CompareTo(right.MinY);
        }

        static void MarkOutermost(List<DrawingFrameCandidate> candidates, double tolerance)
        {
            foreach (DrawingFrameCandidate candidate in candidates)
            {
                candidate.IsOutermost = true;
                foreach (DrawingFrameCandidate other in candidates)
                {
                    if (ReferenceEquals(candidate, other) || other.Area <= candidate.Area)
                    {
                        continue;
                    }

                    if (other.MinX <= candidate.MinX + tolerance
                        && other.MinY <= candidate.MinY + tolerance
                        && other.MaxX >= candidate.MaxX - tolerance
                        && other.MaxY >= candidate.MaxY - tolerance)
                    {
                        candidate.IsOutermost = false;
                        break;
                    }
                }
            }
        }
    }
}
