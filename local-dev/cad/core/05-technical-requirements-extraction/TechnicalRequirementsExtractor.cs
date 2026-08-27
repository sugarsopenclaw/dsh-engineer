using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Shb.Cad.Core
{
    public sealed class TechnicalRequirementsFrameBounds
    {
        public TechnicalRequirementsFrameBounds(
            string frameId,
            double minX,
            double minY,
            double maxX,
            double maxY)
        {
            FrameId = frameId ?? "";
            MinX = Math.Min(minX, maxX);
            MinY = Math.Min(minY, maxY);
            MaxX = Math.Max(minX, maxX);
            MaxY = Math.Max(minY, maxY);
        }

        public string FrameId { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }
        public double Width { get { return MaxX - MinX; } }
        public double Height { get { return MaxY - MinY; } }

        internal bool ContainsCenter(TechnicalRequirementTextObservation text)
        {
            return text.CenterX >= MinX
                && text.CenterX <= MaxX
                && text.CenterY >= MinY
                && text.CenterY <= MaxY;
        }
    }

    public sealed class TechnicalRequirementTextObservation
    {
        public TechnicalRequirementTextObservation(
            string handle,
            string layer,
            string text,
            double minX,
            double minY,
            double maxX,
            double maxY)
        {
            Handle = handle ?? "";
            Layer = layer ?? "";
            Text = text ?? "";
            MinX = Math.Min(minX, maxX);
            MinY = Math.Min(minY, maxY);
            MaxX = Math.Max(minX, maxX);
            MaxY = Math.Max(minY, maxY);
        }

        public string Handle { get; private set; }
        public string Layer { get; private set; }
        public string Text { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }
        public double CenterX { get { return (MinX + MaxX) * 0.5; } }
        public double CenterY { get { return (MinY + MaxY) * 0.5; } }
        public double Width { get { return MaxX - MinX; } }
        public double Height { get { return MaxY - MinY; } }
    }

    public sealed class TechnicalRequirementsExtractionConfig
    {
        public TechnicalRequirementsExtractionConfig()
        {
            TitleMarker = "技术要求";
            RequireSameLayer = true;
            TitleSearchLeftRatio = 0.15;
            TitleSearchRightRatio = 0.10;
            FirstItemMaxVerticalGapRatio = 0.07;
            ItemLeftToleranceRatio = 0.04;
            MaximumNumberedLineGapRatio = 0.08;
            MaximumSectionHeightRatio = 0.45;
            ContinuationLeftToleranceRatio = 0.02;
            ContinuationRightSpanRatio = 0.15;
            LastItemContinuationPitchMultiplier = 1.40;
        }

        public string TitleMarker { get; set; }
        public bool RequireSameLayer { get; set; }
        public double TitleSearchLeftRatio { get; set; }
        public double TitleSearchRightRatio { get; set; }
        public double FirstItemMaxVerticalGapRatio { get; set; }
        public double ItemLeftToleranceRatio { get; set; }
        public double MaximumNumberedLineGapRatio { get; set; }
        public double MaximumSectionHeightRatio { get; set; }
        public double ContinuationLeftToleranceRatio { get; set; }
        public double ContinuationRightSpanRatio { get; set; }
        public double LastItemContinuationPitchMultiplier { get; set; }
    }

    public sealed class TechnicalRequirementItem
    {
        internal TechnicalRequirementItem(
            int number,
            string content,
            IList<TechnicalRequirementTextObservation> lines)
        {
            Number = number;
            Content = content ?? "";
            RawLines = new List<string>();
            SourceHandles = new List<string>();
            bool first = true;
            foreach (TechnicalRequirementTextObservation line in lines)
            {
                RawLines.Add(line.Text);
                SourceHandles.Add(line.Handle);
                if (first)
                {
                    MinX = line.MinX;
                    MinY = line.MinY;
                    MaxX = line.MaxX;
                    MaxY = line.MaxY;
                    first = false;
                }
                else
                {
                    MinX = Math.Min(MinX, line.MinX);
                    MinY = Math.Min(MinY, line.MinY);
                    MaxX = Math.Max(MaxX, line.MaxX);
                    MaxY = Math.Max(MaxY, line.MaxY);
                }
            }
        }

        public int Number { get; private set; }
        public string Content { get; private set; }
        public IList<string> RawLines { get; private set; }
        public IList<string> SourceHandles { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }

        internal Dictionary<string, object> ToMap()
        {
            return TechnicalRequirementsMaps.Map(
                "number", Number,
                "content", Content,
                "raw_lines", RawLines,
                "source_handles", SourceHandles,
                "bbox", TechnicalRequirementsMaps.Map(
                    "min", new[] { MinX, MinY },
                    "max", new[] { MaxX, MaxY }));
        }
    }

    public sealed class TechnicalRequirementsSection
    {
        internal TechnicalRequirementsSection(
            string id,
            TechnicalRequirementsFrameBounds frame,
            TechnicalRequirementTextObservation title)
        {
            Id = id;
            Frame = frame;
            Title = title;
            Items = new List<TechnicalRequirementItem>();
            MissingNumbers = new List<int>();
            DuplicateNumbers = new List<int>();
            MinX = title.MinX;
            MinY = title.MinY;
            MaxX = title.MaxX;
            MaxY = title.MaxY;
        }

        public string Id { get; private set; }
        public TechnicalRequirementsFrameBounds Frame { get; private set; }
        public TechnicalRequirementTextObservation Title { get; private set; }
        public IList<TechnicalRequirementItem> Items { get; private set; }
        public int? MinimumNumber { get; internal set; }
        public int? MaximumNumber { get; internal set; }
        public bool StartsAtOne { get; internal set; }
        public bool SpatialOrderIsStrictlyIncreasing { get; internal set; }
        public bool SequenceIsContiguous { get; internal set; }
        public IList<int> MissingNumbers { get; private set; }
        public IList<int> DuplicateNumbers { get; private set; }
        public double MinX { get; internal set; }
        public double MinY { get; internal set; }
        public double MaxX { get; internal set; }
        public double MaxY { get; internal set; }

        internal Dictionary<string, object> ToMap()
        {
            var items = new List<Dictionary<string, object>>();
            foreach (TechnicalRequirementItem item in Items)
            {
                items.Add(item.ToMap());
            }

            return TechnicalRequirementsMaps.Map(
                "id", Id,
                "kind", "technical_requirements",
                "frame_id", Frame.FrameId,
                "title", TechnicalRequirementsMaps.Map(
                    "text", Title.Text,
                    "handle", Title.Handle,
                    "layer", Title.Layer,
                    "bbox", TechnicalRequirementsMaps.Map(
                        "min", new[] { Title.MinX, Title.MinY },
                        "max", new[] { Title.MaxX, Title.MaxY })),
                "bounds", TechnicalRequirementsMaps.Map(
                    "min", new[] { MinX, MinY },
                    "max", new[] { MaxX, MaxY }),
                "item_count", Items.Count,
                "sequence", TechnicalRequirementsMaps.Map(
                    "minimum", MinimumNumber,
                    "maximum", MaximumNumber,
                    "starts_at_one", StartsAtOne,
                    "spatial_order_strictly_increasing", SpatialOrderIsStrictlyIncreasing,
                    "contiguous", SequenceIsContiguous,
                    "missing", MissingNumbers,
                    "duplicates", DuplicateNumbers),
                "items", items);
        }
    }

    public sealed class TechnicalRequirementsDocument
    {
        internal TechnicalRequirementsDocument(string drawingId, int frameCount)
        {
            DrawingId = drawingId ?? "";
            FrameCount = frameCount;
            Sections = new List<TechnicalRequirementsSection>();
        }

        public string DrawingId { get; private set; }
        public int FrameCount { get; private set; }
        public int TitleCandidateCount { get; internal set; }
        public IList<TechnicalRequirementsSection> Sections { get; private set; }

        public int ItemCount
        {
            get
            {
                int count = 0;
                foreach (TechnicalRequirementsSection section in Sections)
                {
                    count += section.Items.Count;
                }
                return count;
            }
        }

        public Dictionary<string, object> ToMap()
        {
            var sections = new List<Dictionary<string, object>>();
            foreach (TechnicalRequirementsSection section in Sections)
            {
                sections.Add(section.ToMap());
            }

            string status = Sections.Count == 0
                ? (TitleCandidateCount == 0 ? "title_not_detected" : "title_without_numbered_items")
                : "extracted";
            return TechnicalRequirementsMaps.Map(
                "schema_version", "1",
                "knowledge_type", "technical_requirements",
                "extractor", "technical_requirements_extractor",
                "extractor_version", "1",
                "drawing_id", DrawingId,
                "status", status,
                "frame_count", FrameCount,
                "title_candidate_count", TitleCandidateCount,
                "section_count", Sections.Count,
                "item_count", ItemCount,
                "sections", sections,
                "limits", new[]
                {
                    "explicit_title_marker_required",
                    "numbered_text_items_only",
                    "same_layer_spatial_grouping_by_default",
                    "missing_numbers_are_reported_not_repaired"
                });
        }

        public string ToMarkdown()
        {
            var markdown = new StringBuilder();
            markdown.AppendLine("# 技术要求");
            markdown.AppendLine();
            markdown.Append("图纸：`");
            markdown.Append((DrawingId ?? "").Replace("`", "\\`"));
            markdown.AppendLine("`");
            markdown.AppendLine();

            if (Sections.Count == 0)
            {
                markdown.AppendLine(TitleCandidateCount == 0
                    ? "未检测到包含“技术要求”的标题。"
                    : "检测到“技术要求”标题，但未形成编号条目。");
                return markdown.ToString();
            }

            for (int sectionIndex = 0; sectionIndex < Sections.Count; sectionIndex++)
            {
                TechnicalRequirementsSection section = Sections[sectionIndex];
                markdown.AppendLine(Sections.Count == 1
                    ? "## 技术要求"
                    : "## 技术要求 " + (sectionIndex + 1).ToString(CultureInfo.InvariantCulture));
                markdown.AppendLine();
                foreach (TechnicalRequirementItem item in section.Items)
                {
                    markdown.Append("- **");
                    markdown.Append(item.Number.ToString(CultureInfo.InvariantCulture));
                    markdown.Append("**：");
                    markdown.AppendLine(item.Content);
                }
                markdown.AppendLine();
                AppendSequenceSummary(markdown, section);
                if (sectionIndex + 1 < Sections.Count)
                {
                    markdown.AppendLine();
                }
            }
            return markdown.ToString();
        }

        static void AppendSequenceSummary(
            StringBuilder markdown,
            TechnicalRequirementsSection section)
        {
            if (section.MissingNumbers.Count == 0
                && section.DuplicateNumbers.Count == 0
                && section.SpatialOrderIsStrictlyIncreasing)
            {
                markdown.Append("> 编号检查：");
                markdown.Append(section.MinimumNumber.HasValue
                    ? section.MinimumNumber.Value.ToString(CultureInfo.InvariantCulture)
                    : "-");
                markdown.Append("–");
                markdown.Append(section.MaximumNumber.HasValue
                    ? section.MaximumNumber.Value.ToString(CultureInfo.InvariantCulture)
                    : "-");
                markdown.AppendLine(" 连续。");
                return;
            }

            var findings = new List<string>();
            if (section.MissingNumbers.Count > 0)
            {
                findings.Add("缺号 " + JoinIntegers(section.MissingNumbers));
            }
            if (section.DuplicateNumbers.Count > 0)
            {
                findings.Add("重号 " + JoinIntegers(section.DuplicateNumbers));
            }
            if (!section.SpatialOrderIsStrictlyIncreasing)
            {
                findings.Add("空间顺序并非严格递增");
            }
            markdown.Append("> 编号检查：");
            markdown.Append(string.Join("；", findings.ToArray()));
            markdown.AppendLine("。正文按源图编号原样保留。");
        }

        static string JoinIntegers(IList<int> values)
        {
            var rendered = new List<string>();
            foreach (int value in values)
            {
                rendered.Add(value.ToString(CultureInfo.InvariantCulture));
            }
            return string.Join("、", rendered.ToArray());
        }
    }

    public static class TechnicalRequirementsExtractor
    {
        static readonly Regex NumberedLine = new Regex(
            @"^\s*([0-9]{1,3})\s*[\.．、]\s*(.*)$",
            RegexOptions.CultureInvariant | RegexOptions.Singleline);

        public static TechnicalRequirementsDocument Extract(
            string drawingId,
            IList<TechnicalRequirementsFrameBounds> frames,
            IList<TechnicalRequirementTextObservation> sourceTexts,
            TechnicalRequirementsExtractionConfig config = null)
        {
            if (frames == null)
            {
                throw new ArgumentNullException("frames");
            }
            if (sourceTexts == null)
            {
                throw new ArgumentNullException("sourceTexts");
            }
            config = config ?? new TechnicalRequirementsExtractionConfig();
            Validate(config);

            var document = new TechnicalRequirementsDocument(drawingId, frames.Count);
            var usedTitles = new HashSet<string>(StringComparer.Ordinal);
            foreach (TechnicalRequirementsFrameBounds frame in frames)
            {
                if (frame == null || frame.Width <= 0 || frame.Height <= 0)
                {
                    continue;
                }

                var frameTexts = new List<TechnicalRequirementTextObservation>();
                foreach (TechnicalRequirementTextObservation text in sourceTexts)
                {
                    if (text != null && frame.ContainsCenter(text))
                    {
                        frameTexts.Add(text);
                    }
                }

                var titles = new List<TechnicalRequirementTextObservation>();
                foreach (TechnicalRequirementTextObservation text in frameTexts)
                {
                    int unusedNumber;
                    string unusedContent;
                    if (ContainsTitle(text.Text, config.TitleMarker)
                        && !TryParseNumberedLine(text.Text, out unusedNumber, out unusedContent))
                    {
                        string titleKey = string.IsNullOrEmpty(text.Handle)
                            ? frame.FrameId + "|" + text.CenterX.ToString("R", CultureInfo.InvariantCulture)
                                + "|" + text.CenterY.ToString("R", CultureInfo.InvariantCulture)
                            : text.Handle;
                        if (usedTitles.Add(titleKey))
                        {
                            titles.Add(text);
                            document.TitleCandidateCount++;
                        }
                    }
                }
                titles.Sort(CompareTopToBottom);

                foreach (TechnicalRequirementTextObservation title in titles)
                {
                    TechnicalRequirementsSection section = BuildSection(
                        "technical-requirements-" + (document.Sections.Count + 1)
                            .ToString(CultureInfo.InvariantCulture),
                        frame,
                        title,
                        frameTexts,
                        config);
                    if (section.Items.Count > 0)
                    {
                        document.Sections.Add(section);
                    }
                }
            }
            return document;
        }

        static TechnicalRequirementsSection BuildSection(
            string id,
            TechnicalRequirementsFrameBounds frame,
            TechnicalRequirementTextObservation title,
            IList<TechnicalRequirementTextObservation> frameTexts,
            TechnicalRequirementsExtractionConfig config)
        {
            var section = new TechnicalRequirementsSection(id, frame, title);
            var numbered = new List<NumberedObservation>();
            foreach (TechnicalRequirementTextObservation text in frameTexts)
            {
                if (ReferenceEquals(text, title)
                    || (config.RequireSameLayer
                        && !string.Equals(text.Layer, title.Layer, StringComparison.Ordinal)))
                {
                    continue;
                }

                double verticalDistance = title.CenterY - text.CenterY;
                if (verticalDistance <= 0
                    || verticalDistance > frame.Height * config.MaximumSectionHeightRatio
                    || text.MinX < title.MinX - frame.Width * config.TitleSearchLeftRatio
                    || text.MinX > title.MaxX + frame.Width * config.TitleSearchRightRatio)
                {
                    continue;
                }

                int number;
                string content;
                if (TryParseNumberedLine(text.Text, out number, out content))
                {
                    numbered.Add(new NumberedObservation(number, content, text));
                }
            }
            numbered.Sort(CompareNumberedTopToBottom);
            if (numbered.Count == 0
                || title.CenterY - numbered[0].Text.CenterY
                    > frame.Height * config.FirstItemMaxVerticalGapRatio)
            {
                return section;
            }

            double baseX = numbered[0].Text.MinX;
            double leftTolerance = frame.Width * config.ItemLeftToleranceRatio;
            var selected = new List<NumberedObservation>();
            foreach (NumberedObservation candidate in numbered)
            {
                if (Math.Abs(candidate.Text.MinX - baseX) > leftTolerance)
                {
                    continue;
                }
                if (selected.Count == 0)
                {
                    selected.Add(candidate);
                    continue;
                }

                NumberedObservation previous = selected[selected.Count - 1];
                double gap = previous.Text.CenterY - candidate.Text.CenterY;
                if (gap <= 0)
                {
                    continue;
                }
                if (gap > frame.Height * config.MaximumNumberedLineGapRatio
                    || candidate.Number < previous.Number)
                {
                    break;
                }
                selected.Add(candidate);
            }
            if (selected.Count == 0)
            {
                return section;
            }

            double pitch = EstimatePitch(selected, frame);
            var selectedHandles = new HashSet<string>(StringComparer.Ordinal);
            foreach (NumberedObservation item in selected)
            {
                if (!string.IsNullOrEmpty(item.Text.Handle))
                {
                    selectedHandles.Add(item.Text.Handle);
                }
            }

            for (int index = 0; index < selected.Count; index++)
            {
                NumberedObservation numberedItem = selected[index];
                double lowerCenter = index + 1 < selected.Count
                    ? selected[index + 1].Text.CenterY
                    : numberedItem.Text.CenterY
                        - pitch * config.LastItemContinuationPitchMultiplier;
                var continuation = new List<TechnicalRequirementTextObservation>();
                foreach (TechnicalRequirementTextObservation text in frameTexts)
                {
                    if (ReferenceEquals(text, title)
                        || selectedHandles.Contains(text.Handle)
                        || (config.RequireSameLayer
                            && !string.Equals(text.Layer, title.Layer, StringComparison.Ordinal))
                        || text.CenterY >= numberedItem.Text.CenterY
                        || text.CenterY <= lowerCenter
                        || text.MinX < baseX - frame.Width * config.ContinuationLeftToleranceRatio
                        || text.MinX > baseX + frame.Width * config.ContinuationRightSpanRatio)
                    {
                        continue;
                    }

                    int ignoredNumber;
                    string ignoredContent;
                    string normalized = NormalizeInline(text.Text);
                    if (normalized.Length >= 2
                        && !ContainsTitle(normalized, config.TitleMarker)
                        && !TryParseNumberedLine(normalized, out ignoredNumber, out ignoredContent))
                    {
                        continuation.Add(text);
                    }
                }
                continuation.Sort(CompareTopToBottom);

                var lines = new List<TechnicalRequirementTextObservation>();
                lines.Add(numberedItem.Text);
                lines.AddRange(continuation);
                string content = numberedItem.Content;
                foreach (TechnicalRequirementTextObservation line in continuation)
                {
                    content += NormalizeInline(line.Text);
                }
                section.Items.Add(new TechnicalRequirementItem(
                    numberedItem.Number,
                    content,
                    lines));
            }

            Summarize(section);
            return section;
        }

        static void Summarize(TechnicalRequirementsSection section)
        {
            var counts = new Dictionary<int, int>();
            bool strictlyIncreasing = true;
            int? previous = null;
            foreach (TechnicalRequirementItem item in section.Items)
            {
                counts[item.Number] = counts.ContainsKey(item.Number)
                    ? counts[item.Number] + 1
                    : 1;
                section.MinimumNumber = !section.MinimumNumber.HasValue
                    ? item.Number
                    : Math.Min(section.MinimumNumber.Value, item.Number);
                section.MaximumNumber = !section.MaximumNumber.HasValue
                    ? item.Number
                    : Math.Max(section.MaximumNumber.Value, item.Number);
                if (previous.HasValue && item.Number <= previous.Value)
                {
                    strictlyIncreasing = false;
                }
                previous = item.Number;

                section.MinX = Math.Min(section.MinX, item.MinX);
                section.MinY = Math.Min(section.MinY, item.MinY);
                section.MaxX = Math.Max(section.MaxX, item.MaxX);
                section.MaxY = Math.Max(section.MaxY, item.MaxY);
            }

            foreach (KeyValuePair<int, int> pair in counts)
            {
                if (pair.Value > 1)
                {
                    section.DuplicateNumbers.Add(pair.Key);
                }
            }
            if (section.MinimumNumber.HasValue && section.MaximumNumber.HasValue)
            {
                for (int number = section.MinimumNumber.Value;
                    number <= section.MaximumNumber.Value;
                    number++)
                {
                    if (!counts.ContainsKey(number))
                    {
                        section.MissingNumbers.Add(number);
                    }
                }
            }
            section.StartsAtOne = section.MinimumNumber == 1;
            section.SpatialOrderIsStrictlyIncreasing = strictlyIncreasing;
            section.SequenceIsContiguous = section.Items.Count > 0
                && section.StartsAtOne
                && strictlyIncreasing
                && section.MissingNumbers.Count == 0
                && section.DuplicateNumbers.Count == 0;
        }

        static double EstimatePitch(
            IList<NumberedObservation> selected,
            TechnicalRequirementsFrameBounds frame)
        {
            var gaps = new List<double>();
            for (int index = 1; index < selected.Count; index++)
            {
                double gap = selected[index - 1].Text.CenterY - selected[index].Text.CenterY;
                if (gap > 0)
                {
                    gaps.Add(gap);
                }
            }
            if (gaps.Count == 0)
            {
                return Math.Max(selected[0].Text.Height * 1.5, frame.Height * 0.015);
            }
            gaps.Sort();
            int middle = gaps.Count / 2;
            return gaps.Count % 2 == 1
                ? gaps[middle]
                : (gaps[middle - 1] + gaps[middle]) * 0.5;
        }

        static bool ContainsTitle(string value, string marker)
        {
            return NormalizeInline(value).IndexOf(marker, StringComparison.Ordinal) >= 0;
        }

        static bool TryParseNumberedLine(
            string value,
            out int number,
            out string content)
        {
            number = 0;
            content = "";
            Match match = NumberedLine.Match(value ?? "");
            if (!match.Success
                || !int.TryParse(
                    match.Groups[1].Value,
                    NumberStyles.None,
                    CultureInfo.InvariantCulture,
                    out number))
            {
                return false;
            }
            content = NormalizeInline(match.Groups[2].Value);
            return true;
        }

        static string NormalizeInline(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return "";
            }
            return Regex.Replace(value.Trim(), @"\s+", " ");
        }

        static int CompareTopToBottom(
            TechnicalRequirementTextObservation left,
            TechnicalRequirementTextObservation right)
        {
            int y = right.CenterY.CompareTo(left.CenterY);
            if (y != 0)
            {
                return y;
            }
            int x = left.MinX.CompareTo(right.MinX);
            return x != 0
                ? x
                : string.Compare(left.Handle, right.Handle, StringComparison.Ordinal);
        }

        static int CompareNumberedTopToBottom(
            NumberedObservation left,
            NumberedObservation right)
        {
            return CompareTopToBottom(left.Text, right.Text);
        }

        static void Validate(TechnicalRequirementsExtractionConfig config)
        {
            if (string.IsNullOrWhiteSpace(config.TitleMarker))
            {
                throw new ArgumentException("TitleMarker must not be empty.", "config");
            }
            if (config.TitleSearchLeftRatio < 0
                || config.TitleSearchRightRatio < 0
                || config.FirstItemMaxVerticalGapRatio <= 0
                || config.ItemLeftToleranceRatio < 0
                || config.MaximumNumberedLineGapRatio <= 0
                || config.MaximumSectionHeightRatio <= 0
                || config.ContinuationLeftToleranceRatio < 0
                || config.ContinuationRightSpanRatio < 0
                || config.LastItemContinuationPitchMultiplier <= 0)
            {
                throw new ArgumentOutOfRangeException("config", "Ratios must be non-negative and gaps must be positive.");
            }
        }

        sealed class NumberedObservation
        {
            public NumberedObservation(
                int number,
                string content,
                TechnicalRequirementTextObservation text)
            {
                Number = number;
                Content = content;
                Text = text;
            }

            public int Number;
            public string Content;
            public TechnicalRequirementTextObservation Text;
        }
    }

    internal static class TechnicalRequirementsMaps
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
