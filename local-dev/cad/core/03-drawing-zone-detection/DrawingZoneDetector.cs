using System;
using System.Collections.Generic;
using System.Globalization;

namespace Shb.Cad.Core
{
    // Host-neutral text anchor. CAD adapters should pass the effective alignment
    // point for centered DBText, not the raw insertion point or glyph bbox center.
    public sealed class DrawingZoneTextSample
    {
        public DrawingZoneTextSample(
            string handle,
            string layer,
            string text,
            double anchorX,
            double anchorY)
        {
            Handle = handle ?? "";
            Layer = layer ?? "";
            Text = text ?? "";
            AnchorX = anchorX;
            AnchorY = anchorY;
        }

        public string Handle { get; private set; }
        public string Layer { get; private set; }
        public string Text { get; private set; }
        public double AnchorX { get; private set; }
        public double AnchorY { get; private set; }
    }

    // The rectangle here is the inner drawing-area frame. Zone labels sit in the
    // narrow band outside this rectangle and inside the physical sheet border.
    public sealed class DrawingZoneFrameBounds
    {
        public DrawingZoneFrameBounds(
            string frameId,
            double minX,
            double minY,
            double maxX,
            double maxY)
        {
            if (maxX <= minX || maxY <= minY)
            {
                throw new ArgumentException("Frame bounds must have positive width and height.");
            }

            FrameId = frameId ?? "";
            MinX = minX;
            MinY = minY;
            MaxX = maxX;
            MaxY = maxY;
        }

        public string FrameId { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }
        public double Width { get { return MaxX - MinX; } }
        public double Height { get { return MaxY - MinY; } }
    }

    public sealed class DrawingZoneDetectorOptions
    {
        public DrawingZoneDetectorOptions()
        {
            BorderBandRatio = 0.05;
            OppositeSideCoordinateToleranceRatio = 0.01;
            MinimumLabelsPerAxis = 2;
            RequireOppositeSidePair = true;
            CoordinateTolerance = 0.001;
        }

        public double BorderBandRatio { get; set; }
        public double OppositeSideCoordinateToleranceRatio { get; set; }
        public int MinimumLabelsPerAxis { get; set; }
        public bool RequireOppositeSidePair { get; set; }
        public double CoordinateTolerance { get; set; }
    }

    public sealed class DrawingZoneColumn
    {
        internal DrawingZoneColumn(
            string label,
            int order,
            double centerX,
            double minX,
            double maxX,
            string topHandle,
            string bottomHandle)
        {
            Label = label;
            Order = order;
            CenterX = centerX;
            MinX = minX;
            MaxX = maxX;
            TopHandle = topHandle ?? "";
            BottomHandle = bottomHandle ?? "";
        }

        public string Label { get; private set; }
        public int Order { get; private set; }
        public double CenterX { get; private set; }
        public double MinX { get; private set; }
        public double MaxX { get; private set; }
        public string TopHandle { get; private set; }
        public string BottomHandle { get; private set; }

        internal Dictionary<string, object> ToMap()
        {
            return DrawingZoneMaps.Map(
                "label", Label,
                "order", Order,
                "center_x", CenterX,
                "min_x", MinX,
                "max_x", MaxX,
                "evidence_handles", DrawingZoneMaps.Map(
                    "top", TopHandle,
                    "bottom", BottomHandle));
        }
    }

    public sealed class DrawingZoneRow
    {
        internal DrawingZoneRow(
            string label,
            int order,
            double centerY,
            double minY,
            double maxY,
            string leftHandle,
            string rightHandle)
        {
            Label = label;
            Order = order;
            CenterY = centerY;
            MinY = minY;
            MaxY = maxY;
            LeftHandle = leftHandle ?? "";
            RightHandle = rightHandle ?? "";
        }

        public string Label { get; private set; }
        public int Order { get; private set; }
        public double CenterY { get; private set; }
        public double MinY { get; private set; }
        public double MaxY { get; private set; }
        public string LeftHandle { get; private set; }
        public string RightHandle { get; private set; }

        internal Dictionary<string, object> ToMap()
        {
            return DrawingZoneMaps.Map(
                "label", Label,
                "order", Order,
                "center_y", CenterY,
                "min_y", MinY,
                "max_y", MaxY,
                "evidence_handles", DrawingZoneMaps.Map(
                    "left", LeftHandle,
                    "right", RightHandle));
        }
    }

    public sealed class DrawingZoneLocation
    {
        internal DrawingZoneLocation()
        {
            OverlappingZoneIds = new List<string>();
            PrimaryZoneId = "";
            RowLabel = "";
            ColumnLabel = "";
        }

        public bool IsDetected { get; internal set; }
        public bool IsInsideFrame { get; internal set; }
        public bool IntersectsFrame { get; internal set; }
        public bool IsOnZoneBoundary { get; internal set; }
        public string PrimaryZoneId { get; internal set; }
        public string RowLabel { get; internal set; }
        public string ColumnLabel { get; internal set; }
        public IList<string> OverlappingZoneIds { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return DrawingZoneMaps.Map(
                "detected", IsDetected,
                "inside_frame", IsInsideFrame,
                "intersects_frame", IntersectsFrame,
                "on_zone_boundary", IsOnZoneBoundary,
                "primary_zone", PrimaryZoneId,
                "row", RowLabel,
                "column", ColumnLabel,
                "overlapping_zones", OverlappingZoneIds);
        }
    }

    public sealed class DrawingZoneSystem
    {
        internal DrawingZoneSystem(DrawingZoneFrameBounds frame, double coordinateTolerance)
        {
            Frame = frame;
            CoordinateTolerance = coordinateTolerance;
            Columns = new List<DrawingZoneColumn>();
            Rows = new List<DrawingZoneRow>();
        }

        public DrawingZoneFrameBounds Frame { get; private set; }
        public double CoordinateTolerance { get; private set; }
        public IList<DrawingZoneColumn> Columns { get; private set; }
        public IList<DrawingZoneRow> Rows { get; private set; }
        public bool IsDetected { get { return Columns.Count > 0 && Rows.Count > 0; } }

        public DrawingZoneLocation LocatePoint(double x, double y)
        {
            var result = new DrawingZoneLocation();
            result.IsDetected = IsDetected;
            if (!IsDetected)
            {
                return result;
            }

            result.IsInsideFrame = ContainsPoint(x, y);
            result.IntersectsFrame = result.IsInsideFrame;
            if (!result.IsInsideFrame)
            {
                return result;
            }

            DrawingZoneColumn column = FindColumn(x);
            DrawingZoneRow row = FindRow(y);
            if (column == null || row == null)
            {
                return result;
            }

            result.ColumnLabel = column.Label;
            result.RowLabel = row.Label;
            result.PrimaryZoneId = row.Label + column.Label;
            result.OverlappingZoneIds.Add(result.PrimaryZoneId);
            result.IsOnZoneBoundary = IsNear(x, column.MinX)
                || IsNear(x, column.MaxX)
                || IsNear(y, row.MinY)
                || IsNear(y, row.MaxY);
            return result;
        }

        public DrawingZoneLocation LocateBounds(
            double minX,
            double minY,
            double maxX,
            double maxY)
        {
            if (maxX < minX)
            {
                double swap = minX;
                minX = maxX;
                maxX = swap;
            }
            if (maxY < minY)
            {
                double swap = minY;
                minY = maxY;
                maxY = swap;
            }

            var result = new DrawingZoneLocation();
            result.IsDetected = IsDetected;
            if (!IsDetected)
            {
                return result;
            }

            result.IntersectsFrame = IntervalsOverlap(minX, maxX, Frame.MinX, Frame.MaxX)
                && IntervalsOverlap(minY, maxY, Frame.MinY, Frame.MaxY);
            result.IsInsideFrame = minX >= Frame.MinX - CoordinateTolerance
                && maxX <= Frame.MaxX + CoordinateTolerance
                && minY >= Frame.MinY - CoordinateTolerance
                && maxY <= Frame.MaxY + CoordinateTolerance;
            if (!result.IntersectsFrame)
            {
                return result;
            }

            double centerX = Clamp((minX + maxX) * 0.5, Frame.MinX, Frame.MaxX);
            double centerY = Clamp((minY + maxY) * 0.5, Frame.MinY, Frame.MaxY);
            DrawingZoneLocation primary = LocatePoint(centerX, centerY);
            result.PrimaryZoneId = primary.PrimaryZoneId;
            result.RowLabel = primary.RowLabel;
            result.ColumnLabel = primary.ColumnLabel;
            result.IsOnZoneBoundary = primary.IsOnZoneBoundary;

            foreach (DrawingZoneRow row in Rows)
            {
                if (!IntervalsOverlap(minY, maxY, row.MinY, row.MaxY))
                {
                    continue;
                }
                foreach (DrawingZoneColumn column in Columns)
                {
                    if (IntervalsOverlap(minX, maxX, column.MinX, column.MaxX))
                    {
                        result.OverlappingZoneIds.Add(row.Label + column.Label);
                    }
                }
            }
            return result;
        }

        internal Dictionary<string, object> ToMap()
        {
            var columns = new List<Dictionary<string, object>>();
            foreach (DrawingZoneColumn column in Columns)
            {
                columns.Add(column.ToMap());
            }
            var rows = new List<Dictionary<string, object>>();
            foreach (DrawingZoneRow row in Rows)
            {
                rows.Add(row.ToMap());
            }

            return DrawingZoneMaps.Map(
                "frame_id", Frame.FrameId,
                "frame_role", "drawing_area_inner_frame",
                "frame_min", new[] { Frame.MinX, Frame.MinY },
                "frame_max", new[] { Frame.MaxX, Frame.MaxY },
                "detected", IsDetected,
                "column_count", Columns.Count,
                "row_count", Rows.Count,
                "zone_count", Columns.Count * Rows.Count,
                "zone_id_format", "<row><column>",
                "columns", columns,
                "rows", rows);
        }

        DrawingZoneColumn FindColumn(double x)
        {
            foreach (DrawingZoneColumn column in Columns)
            {
                if (x >= column.MinX - CoordinateTolerance
                    && x <= column.MaxX + CoordinateTolerance)
                {
                    return column;
                }
            }
            return null;
        }

        DrawingZoneRow FindRow(double y)
        {
            foreach (DrawingZoneRow row in Rows)
            {
                if (y >= row.MinY - CoordinateTolerance
                    && y <= row.MaxY + CoordinateTolerance)
                {
                    return row;
                }
            }
            return null;
        }

        bool ContainsPoint(double x, double y)
        {
            return x >= Frame.MinX - CoordinateTolerance
                && x <= Frame.MaxX + CoordinateTolerance
                && y >= Frame.MinY - CoordinateTolerance
                && y <= Frame.MaxY + CoordinateTolerance;
        }

        bool IntervalsOverlap(double min1, double max1, double min2, double max2)
        {
            return max1 >= min2 - CoordinateTolerance
                && min1 <= max2 + CoordinateTolerance;
        }

        bool IsNear(double left, double right)
        {
            return Math.Abs(left - right) <= CoordinateTolerance;
        }

        static double Clamp(double value, double min, double max)
        {
            return Math.Max(min, Math.Min(max, value));
        }
    }

    public sealed class DrawingZoneDetectionResult
    {
        internal DrawingZoneDetectionResult(DrawingZoneSystem system)
        {
            System = system;
        }

        public DrawingZoneSystem System { get; private set; }
        public int SourceTextCount { get; internal set; }
        public int TopNumericCandidateCount { get; internal set; }
        public int BottomNumericCandidateCount { get; internal set; }
        public int LeftLetterCandidateCount { get; internal set; }
        public int RightLetterCandidateCount { get; internal set; }
        public int PairedColumnLabelCount { get; internal set; }
        public int PairedRowLabelCount { get; internal set; }
        public DrawingZoneDetectorOptions Options { get; internal set; }

        public Dictionary<string, object> ToMap()
        {
            return DrawingZoneMaps.Map(
                "schema_version", "1",
                "detector", "drawing_zone_detector",
                "detector_version", "1",
                "method", "paired_labels_near_inner_frame",
                "options", DrawingZoneMaps.Map(
                    "border_band_ratio", Options.BorderBandRatio,
                    "opposite_side_coordinate_tolerance_ratio",
                        Options.OppositeSideCoordinateToleranceRatio,
                    "minimum_labels_per_axis", Options.MinimumLabelsPerAxis,
                    "require_opposite_side_pair", Options.RequireOppositeSidePair,
                    "coordinate_tolerance", Options.CoordinateTolerance),
                "limits", new[]
                {
                    "axis_aligned_inner_frame_only",
                    "ascii_integer_columns_only",
                    "single_latin_letter_rows_only",
                    "model_space_text_anchors_only"
                },
                "source_text_count", SourceTextCount,
                "side_candidate_counts", DrawingZoneMaps.Map(
                    "top_numeric", TopNumericCandidateCount,
                    "bottom_numeric", BottomNumericCandidateCount,
                    "left_letter", LeftLetterCandidateCount,
                    "right_letter", RightLetterCandidateCount),
                "paired_column_label_count", PairedColumnLabelCount,
                "paired_row_label_count", PairedRowLabelCount,
                "system", System.ToMap());
        }
    }

    public static class DrawingZoneDetector
    {
        public static DrawingZoneDetectionResult Detect(
            DrawingZoneFrameBounds frame,
            IList<DrawingZoneTextSample> sourceTexts,
            DrawingZoneDetectorOptions options = null)
        {
            if (frame == null)
            {
                throw new ArgumentNullException("frame");
            }
            if (sourceTexts == null)
            {
                throw new ArgumentNullException("sourceTexts");
            }

            options = options ?? new DrawingZoneDetectorOptions();
            ValidateOptions(options);

            var system = new DrawingZoneSystem(frame, options.CoordinateTolerance);
            var result = new DrawingZoneDetectionResult(system);
            result.Options = options;
            result.SourceTextCount = sourceTexts.Count;

            double bandX = frame.Width * options.BorderBandRatio;
            double bandY = frame.Height * options.BorderBandRatio;
            var top = new Dictionary<string, LabelHit>(StringComparer.Ordinal);
            var bottom = new Dictionary<string, LabelHit>(StringComparer.Ordinal);
            var left = new Dictionary<string, LabelHit>(StringComparer.Ordinal);
            var right = new Dictionary<string, LabelHit>(StringComparer.Ordinal);

            foreach (DrawingZoneTextSample sample in sourceTexts)
            {
                if (sample == null)
                {
                    continue;
                }

                string label = NormalizeLabel(sample.Text);
                int order;
                if (TryNumericLabel(label, out order))
                {
                    if (InsideHorizontalSpan(sample.AnchorX, frame, options.CoordinateTolerance))
                    {
                        if (sample.AnchorY > frame.MaxY + options.CoordinateTolerance
                            && sample.AnchorY <= frame.MaxY + bandY)
                        {
                            result.TopNumericCandidateCount++;
                            AddBest(top, new LabelHit(label, order, sample),
                                sample.AnchorY - frame.MaxY);
                        }
                        else if (sample.AnchorY < frame.MinY - options.CoordinateTolerance
                            && sample.AnchorY >= frame.MinY - bandY)
                        {
                            result.BottomNumericCandidateCount++;
                            AddBest(bottom, new LabelHit(label, order, sample),
                                frame.MinY - sample.AnchorY);
                        }
                    }
                }
                else if (TryLetterLabel(label, out order))
                {
                    if (InsideVerticalSpan(sample.AnchorY, frame, options.CoordinateTolerance))
                    {
                        if (sample.AnchorX < frame.MinX - options.CoordinateTolerance
                            && sample.AnchorX >= frame.MinX - bandX)
                        {
                            result.LeftLetterCandidateCount++;
                            AddBest(left, new LabelHit(label, order, sample),
                                frame.MinX - sample.AnchorX);
                        }
                        else if (sample.AnchorX > frame.MaxX + options.CoordinateTolerance
                            && sample.AnchorX <= frame.MaxX + bandX)
                        {
                            result.RightLetterCandidateCount++;
                            AddBest(right, new LabelHit(label, order, sample),
                                sample.AnchorX - frame.MaxX);
                        }
                    }
                }
            }

            List<AxisLabel> columnLabels = PairAxis(
                top,
                bottom,
                true,
                frame.Width * options.OppositeSideCoordinateToleranceRatio,
                options);
            List<AxisLabel> rowLabels = PairAxis(
                left,
                right,
                false,
                frame.Height * options.OppositeSideCoordinateToleranceRatio,
                options);
            result.PairedColumnLabelCount = columnLabels.Count;
            result.PairedRowLabelCount = rowLabels.Count;

            BuildColumns(frame, columnLabels, system.Columns);
            BuildRows(frame, rowLabels, system.Rows);
            return result;
        }

        static List<AxisLabel> PairAxis(
            Dictionary<string, LabelHit> first,
            Dictionary<string, LabelHit> second,
            bool horizontal,
            double coordinateTolerance,
            DrawingZoneDetectorOptions options)
        {
            var paired = new List<AxisLabel>();
            var labels = new HashSet<string>(first.Keys, StringComparer.Ordinal);
            foreach (string label in second.Keys)
            {
                labels.Add(label);
            }

            foreach (string label in labels)
            {
                LabelHit firstHit;
                LabelHit secondHit;
                bool hasFirst = first.TryGetValue(label, out firstHit);
                bool hasSecond = second.TryGetValue(label, out secondHit);
                if (options.RequireOppositeSidePair && (!hasFirst || !hasSecond))
                {
                    continue;
                }

                double firstCoordinate = hasFirst
                    ? (horizontal ? firstHit.Sample.AnchorX : firstHit.Sample.AnchorY)
                    : double.NaN;
                double secondCoordinate = hasSecond
                    ? (horizontal ? secondHit.Sample.AnchorX : secondHit.Sample.AnchorY)
                    : double.NaN;
                if (hasFirst && hasSecond
                    && Math.Abs(firstCoordinate - secondCoordinate) > coordinateTolerance)
                {
                    continue;
                }

                double coordinate = hasFirst && hasSecond
                    ? (firstCoordinate + secondCoordinate) * 0.5
                    : (hasFirst ? firstCoordinate : secondCoordinate);
                int order = hasFirst ? firstHit.Order : secondHit.Order;
                paired.Add(new AxisLabel(
                    label,
                    order,
                    coordinate,
                    hasFirst ? firstHit.Sample.Handle : "",
                    hasSecond ? secondHit.Sample.Handle : ""));
            }

            if (horizontal)
            {
                paired.Sort(AxisLabel.CompareAscending);
            }
            else
            {
                paired.Sort(AxisLabel.CompareDescending);
            }
            return LongestContiguousRun(paired, options.MinimumLabelsPerAxis);
        }

        static List<AxisLabel> LongestContiguousRun(List<AxisLabel> values, int minimum)
        {
            int bestStart = 0;
            int bestLength = values.Count == 0 ? 0 : 1;
            int currentStart = 0;
            for (int i = 1; i < values.Count; i++)
            {
                if (values[i].Order == values[i - 1].Order + 1)
                {
                    int length = i - currentStart + 1;
                    if (length > bestLength)
                    {
                        bestStart = currentStart;
                        bestLength = length;
                    }
                }
                else
                {
                    currentStart = i;
                }
            }

            var result = new List<AxisLabel>();
            if (bestLength < minimum)
            {
                return result;
            }
            for (int i = bestStart; i < bestStart + bestLength; i++)
            {
                result.Add(values[i]);
            }
            return result;
        }

        static void BuildColumns(
            DrawingZoneFrameBounds frame,
            IList<AxisLabel> labels,
            IList<DrawingZoneColumn> output)
        {
            for (int i = 0; i < labels.Count; i++)
            {
                double minX = i == 0
                    ? frame.MinX
                    : (labels[i - 1].Coordinate + labels[i].Coordinate) * 0.5;
                double maxX = i == labels.Count - 1
                    ? frame.MaxX
                    : (labels[i].Coordinate + labels[i + 1].Coordinate) * 0.5;
                output.Add(new DrawingZoneColumn(
                    labels[i].Label,
                    labels[i].Order,
                    labels[i].Coordinate,
                    minX,
                    maxX,
                    labels[i].FirstHandle,
                    labels[i].SecondHandle));
            }
        }

        static void BuildRows(
            DrawingZoneFrameBounds frame,
            IList<AxisLabel> labels,
            IList<DrawingZoneRow> output)
        {
            for (int i = 0; i < labels.Count; i++)
            {
                double maxY = i == 0
                    ? frame.MaxY
                    : (labels[i - 1].Coordinate + labels[i].Coordinate) * 0.5;
                double minY = i == labels.Count - 1
                    ? frame.MinY
                    : (labels[i].Coordinate + labels[i + 1].Coordinate) * 0.5;
                output.Add(new DrawingZoneRow(
                    labels[i].Label,
                    labels[i].Order,
                    labels[i].Coordinate,
                    minY,
                    maxY,
                    labels[i].FirstHandle,
                    labels[i].SecondHandle));
            }
        }

        static void AddBest(
            Dictionary<string, LabelHit> values,
            LabelHit candidate,
            double distanceToFrame)
        {
            candidate.DistanceToFrame = distanceToFrame;
            LabelHit existing;
            if (!values.TryGetValue(candidate.Label, out existing)
                || candidate.DistanceToFrame < existing.DistanceToFrame)
            {
                values[candidate.Label] = candidate;
            }
        }

        static string NormalizeLabel(string value)
        {
            return (value ?? "").Trim().ToUpperInvariant();
        }

        static bool TryNumericLabel(string value, out int order)
        {
            return int.TryParse(
                    value,
                    NumberStyles.None,
                    CultureInfo.InvariantCulture,
                    out order)
                && order > 0;
        }

        static bool TryLetterLabel(string value, out int order)
        {
            order = 0;
            if (value.Length != 1 || value[0] < 'A' || value[0] > 'Z')
            {
                return false;
            }
            order = value[0] - 'A' + 1;
            return true;
        }

        static bool InsideHorizontalSpan(
            double x,
            DrawingZoneFrameBounds frame,
            double tolerance)
        {
            return x >= frame.MinX - tolerance && x <= frame.MaxX + tolerance;
        }

        static bool InsideVerticalSpan(
            double y,
            DrawingZoneFrameBounds frame,
            double tolerance)
        {
            return y >= frame.MinY - tolerance && y <= frame.MaxY + tolerance;
        }

        static void ValidateOptions(DrawingZoneDetectorOptions options)
        {
            if (options.BorderBandRatio <= 0 || options.BorderBandRatio >= 0.5)
            {
                throw new ArgumentOutOfRangeException("BorderBandRatio");
            }
            if (options.OppositeSideCoordinateToleranceRatio < 0)
            {
                throw new ArgumentOutOfRangeException("OppositeSideCoordinateToleranceRatio");
            }
            if (options.MinimumLabelsPerAxis < 2)
            {
                throw new ArgumentOutOfRangeException("MinimumLabelsPerAxis");
            }
            if (options.CoordinateTolerance <= 0)
            {
                throw new ArgumentOutOfRangeException("CoordinateTolerance");
            }
        }

        sealed class LabelHit
        {
            public LabelHit(string label, int order, DrawingZoneTextSample sample)
            {
                Label = label;
                Order = order;
                Sample = sample;
            }

            public string Label;
            public int Order;
            public DrawingZoneTextSample Sample;
            public double DistanceToFrame;
        }

        sealed class AxisLabel
        {
            public AxisLabel(
                string label,
                int order,
                double coordinate,
                string firstHandle,
                string secondHandle)
            {
                Label = label;
                Order = order;
                Coordinate = coordinate;
                FirstHandle = firstHandle;
                SecondHandle = secondHandle;
            }

            public string Label;
            public int Order;
            public double Coordinate;
            public string FirstHandle;
            public string SecondHandle;

            public static int CompareAscending(AxisLabel left, AxisLabel right)
            {
                return left.Coordinate.CompareTo(right.Coordinate);
            }

            public static int CompareDescending(AxisLabel left, AxisLabel right)
            {
                return right.Coordinate.CompareTo(left.Coordinate);
            }
        }
    }

    internal static class DrawingZoneMaps
    {
        public static Dictionary<string, object> Map(params object[] pairs)
        {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            for (int i = 0; i < pairs.Length; i += 2)
            {
                result[(string)pairs[i]] = pairs[i + 1];
            }
            return result;
        }
    }
}
