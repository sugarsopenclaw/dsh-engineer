using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Shb.Cad.Core
{
    public sealed class BodyCenterlineFrameBounds
    {
        public BodyCenterlineFrameBounds(
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
        public double Diagonal { get { return Math.Sqrt(Width * Width + Height * Height); } }

        internal bool Intersects(BodyCenterlineLineObservation line)
        {
            double minX = Math.Min(line.StartX, line.EndX);
            double maxX = Math.Max(line.StartX, line.EndX);
            double minY = Math.Min(line.StartY, line.EndY);
            double maxY = Math.Max(line.StartY, line.EndY);
            return maxX >= MinX && minX <= MaxX && maxY >= MinY && minY <= MaxY;
        }

        internal bool Contains(double x, double y, double tolerance)
        {
            return x >= MinX - tolerance
                && x <= MaxX + tolerance
                && y >= MinY - tolerance
                && y <= MaxY + tolerance;
        }
    }

    public sealed class BodyCenterlineLayerObservation
    {
        public BodyCenterlineLayerObservation(string name, string handle, string linetype)
        {
            Name = name ?? "";
            Handle = handle ?? "";
            Linetype = linetype ?? "";
        }

        public string Name { get; private set; }
        public string Handle { get; private set; }
        public string Linetype { get; private set; }
    }

    public sealed class BodyCenterlineLineObservation
    {
        public BodyCenterlineLineObservation(
            string handle,
            string layer,
            string ownerScope,
            string ownerBlockName,
            double startX,
            double startY,
            double endX,
            double endY)
        {
            Handle = handle ?? "";
            Layer = layer ?? "";
            OwnerScope = ownerScope ?? "";
            OwnerBlockName = ownerBlockName ?? "";
            StartX = startX;
            StartY = startY;
            EndX = endX;
            EndY = endY;
        }

        public string Handle { get; private set; }
        public string Layer { get; private set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public double StartX { get; private set; }
        public double StartY { get; private set; }
        public double EndX { get; private set; }
        public double EndY { get; private set; }
        public double Length
        {
            get
            {
                double dx = EndX - StartX;
                double dy = EndY - StartY;
                return Math.Sqrt(dx * dx + dy * dy);
            }
        }
    }

    public sealed class BodyCenterlineTextObservation
    {
        public BodyCenterlineTextObservation(
            string handle,
            string layer,
            string ownerScope,
            string text,
            double minX,
            double minY,
            double maxX,
            double maxY)
        {
            Handle = handle ?? "";
            Layer = layer ?? "";
            OwnerScope = ownerScope ?? "";
            Text = text ?? "";
            MinX = Math.Min(minX, maxX);
            MinY = Math.Min(minY, maxY);
            MaxX = Math.Max(minX, maxX);
            MaxY = Math.Max(minY, maxY);
        }

        public string Handle { get; private set; }
        public string Layer { get; private set; }
        public string OwnerScope { get; private set; }
        public string Text { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }
        public double CenterX { get { return (MinX + MaxX) * 0.5; } }
        public double CenterY { get { return (MinY + MaxY) * 0.5; } }
    }

    public sealed class BodyCenterlineAnalysisConfig
    {
        public BodyCenterlineAnalysisConfig()
        {
            ExplicitLayerMarker = "器身中心线";
            GenericLayerMarker = "中心线";
            CenterLinetypeMarker = "CENTER";
            TextMarker = "器身中心线";
            MinimumFrameSpanRatio = 0.12;
            ExplicitMinimumFrameSpanRatio = 0.02;
            CollinearAngleToleranceDegrees = 0.75;
            CollinearDistanceRatio = 0.00075;
            CollinearMergeGapRatio = 0.01;
            OrthogonalToleranceDegrees = 2.0;
            IntersectionExtensionRatio = 0.005;
            NearbyTextDistanceRatio = 0.02;
        }

        public string ExplicitLayerMarker { get; set; }
        public string GenericLayerMarker { get; set; }
        public string CenterLinetypeMarker { get; set; }
        public string TextMarker { get; set; }
        public double MinimumFrameSpanRatio { get; set; }
        public double ExplicitMinimumFrameSpanRatio { get; set; }
        public double CollinearAngleToleranceDegrees { get; set; }
        public double CollinearDistanceRatio { get; set; }
        public double CollinearMergeGapRatio { get; set; }
        public double OrthogonalToleranceDegrees { get; set; }
        public double IntersectionExtensionRatio { get; set; }
        public double NearbyTextDistanceRatio { get; set; }
    }

    public sealed class BodyCenterlineLayerEvidence
    {
        internal BodyCenterlineLayerEvidence(BodyCenterlineLayerObservation layer, bool explicitName)
        {
            Layer = layer;
            ExplicitName = explicitName;
        }

        public BodyCenterlineLayerObservation Layer { get; private set; }
        public bool ExplicitName { get; private set; }
        public int ModelSpaceLineCount { get; internal set; }
        public int BlockDefinitionLineCount { get; internal set; }

        internal Dictionary<string, object> ToMap()
        {
            return BodyCenterlineMaps.Map(
                "name", Layer.Name,
                "handle", Layer.Handle,
                "linetype", Layer.Linetype,
                "explicit_body_centerline_name", ExplicitName,
                "model_space_line_count", ModelSpaceLineCount,
                "block_definition_line_count", BlockDefinitionLineCount);
        }
    }

    public sealed class BodyCenterlineAxisCandidate
    {
        double unitX;
        double unitY;

        internal BodyCenterlineAxisCandidate(
            string frameId,
            BodyCenterlineLineObservation line,
            double frameSpanRatio,
            bool explicitLayerEvidence,
            IList<string> evidence)
        {
            FrameId = frameId;
            Layer = line.Layer;
            SourceLayers = new List<string>();
            SourceLayers.Add(line.Layer);
            StartX = line.StartX;
            StartY = line.StartY;
            EndX = line.EndX;
            EndY = line.EndY;
            MakeDirectionStable();
            FrameSpanRatio = frameSpanRatio;
            ExplicitLayerEvidence = explicitLayerEvidence;
            SourceHandles = new List<string>();
            SourceHandles.Add(line.Handle);
            Evidence = new List<string>(evidence);
            NearbyTextMentionHandles = new List<string>();
        }

        public string Id { get; internal set; }
        public string FrameId { get; private set; }
        public string Layer { get; private set; }
        public double StartX { get; private set; }
        public double StartY { get; private set; }
        public double EndX { get; private set; }
        public double EndY { get; private set; }
        public double Length
        {
            get
            {
                double dx = EndX - StartX;
                double dy = EndY - StartY;
                return Math.Sqrt(dx * dx + dy * dy);
            }
        }
        public double OrientationDegrees
        {
            get
            {
                double degrees = Math.Atan2(unitY, unitX) * 180.0 / Math.PI;
                return degrees < 0 ? degrees + 180.0 : degrees;
            }
        }
        public double FrameSpanRatio { get; internal set; }
        public bool ExplicitLayerEvidence { get; internal set; }
        public bool HasExplicitModelEvidence
        {
            get { return ExplicitLayerEvidence || NearbyTextMentionHandles.Count > 0; }
        }
        public int AxisSystemCount { get; internal set; }
        public IList<string> SourceLayers { get; private set; }
        public IList<string> SourceHandles { get; private set; }
        public IList<string> Evidence { get; private set; }
        public IList<string> NearbyTextMentionHandles { get; private set; }

        public double SignedDistance(double x, double y)
        {
            return unitX * (y - StartY) - unitY * (x - StartX);
        }

        public double[] ReflectPoint(double x, double y)
        {
            double projection = (x - StartX) * unitX + (y - StartY) * unitY;
            double projectedX = StartX + projection * unitX;
            double projectedY = StartY + projection * unitY;
            return new[] { 2.0 * projectedX - x, 2.0 * projectedY - y };
        }

        internal double UnitX { get { return unitX; } }
        internal double UnitY { get { return unitY; } }

        internal double DistanceToSegment(double x, double y)
        {
            double length = Length;
            if (length <= 0)
            {
                return Distance(x, y, StartX, StartY);
            }
            double projection = (x - StartX) * unitX + (y - StartY) * unitY;
            projection = Math.Max(0, Math.Min(length, projection));
            return Distance(
                x,
                y,
                StartX + projection * unitX,
                StartY + projection * unitY);
        }

        internal bool IsEquivalent(
            BodyCenterlineAxisCandidate other,
            double angleTolerance,
            double distanceTolerance,
            double gapTolerance)
        {
            if (!string.Equals(FrameId, other.FrameId, StringComparison.Ordinal)
                || ParallelAngleDifference(OrientationDegrees, other.OrientationDegrees)
                    > angleTolerance)
            {
                return false;
            }
            double midpointX = (other.StartX + other.EndX) * 0.5;
            double midpointY = (other.StartY + other.EndY) * 0.5;
            if (Math.Abs(SignedDistance(midpointX, midpointY)) > distanceTolerance)
            {
                return false;
            }

            double otherStart = Projection(other.StartX, other.StartY);
            double otherEnd = Projection(other.EndX, other.EndY);
            double otherMin = Math.Min(otherStart, otherEnd);
            double otherMax = Math.Max(otherStart, otherEnd);
            double ownMin = 0;
            double ownMax = Length;
            return otherMax >= ownMin - gapTolerance && otherMin <= ownMax + gapTolerance;
        }

        internal void Merge(BodyCenterlineAxisCandidate other, BodyCenterlineFrameBounds frame)
        {
            double otherStart = Projection(other.StartX, other.StartY);
            double otherEnd = Projection(other.EndX, other.EndY);
            double minimum = Math.Min(0, Math.Min(otherStart, otherEnd));
            double maximum = Math.Max(Length, Math.Max(otherStart, otherEnd));
            double originX = StartX;
            double originY = StartY;
            StartX = originX + minimum * unitX;
            StartY = originY + minimum * unitY;
            EndX = originX + maximum * unitX;
            EndY = originY + maximum * unitY;
            AddUnique(SourceHandles, other.SourceHandles);
            AddUnique(SourceLayers, other.SourceLayers);
            AddUnique(Evidence, other.Evidence);
            ExplicitLayerEvidence = ExplicitLayerEvidence || other.ExplicitLayerEvidence;
            FrameSpanRatio = SpanRatio(frame);
        }

        internal double SpanRatio(BodyCenterlineFrameBounds frame)
        {
            double available = Math.Abs(unitX) * frame.Width + Math.Abs(unitY) * frame.Height;
            return available <= 0 ? 0 : Length / available;
        }

        internal Dictionary<string, object> ToMap()
        {
            return BodyCenterlineMaps.Map(
                "id", Id,
                "frame_id", FrameId,
                "classification", HasExplicitModelEvidence
                    ? "explicit_body_centerline_candidate"
                    : "geometric_centerline_candidate",
                "layer", Layer,
                "source_layers", SourceLayers,
                "start", new[] { StartX, StartY },
                "end", new[] { EndX, EndY },
                "length", Length,
                "orientation_degrees", OrientationDegrees,
                "frame_span_ratio", FrameSpanRatio,
                "axis_system_count", AxisSystemCount,
                "source_handles", SourceHandles,
                "evidence", Evidence,
                "nearby_text_mention_handles", NearbyTextMentionHandles,
                "symmetry_api", BodyCenterlineMaps.Map(
                    "stable_direction", new[] { unitX, unitY },
                    "positive_side", "left_of_stable_direction",
                    "operations", new[] { "signed_distance", "reflect_point" }));
        }

        double Projection(double x, double y)
        {
            return (x - StartX) * unitX + (y - StartY) * unitY;
        }

        void MakeDirectionStable()
        {
            double dx = EndX - StartX;
            double dy = EndY - StartY;
            if ((Math.Abs(dx) >= Math.Abs(dy) && dx < 0)
                || (Math.Abs(dy) > Math.Abs(dx) && dy < 0))
            {
                double x = StartX;
                double y = StartY;
                StartX = EndX;
                StartY = EndY;
                EndX = x;
                EndY = y;
                dx = -dx;
                dy = -dy;
            }
            double length = Math.Sqrt(dx * dx + dy * dy);
            unitX = length <= 0 ? 1 : dx / length;
            unitY = length <= 0 ? 0 : dy / length;
        }

        static double ParallelAngleDifference(double left, double right)
        {
            double difference = Math.Abs(left - right) % 180.0;
            return Math.Min(difference, 180.0 - difference);
        }

        static double Distance(double x1, double y1, double x2, double y2)
        {
            double dx = x1 - x2;
            double dy = y1 - y2;
            return Math.Sqrt(dx * dx + dy * dy);
        }

        static void AddUnique(IList<string> target, IList<string> source)
        {
            foreach (string value in source)
            {
                bool exists = false;
                foreach (string existing in target)
                {
                    if (string.Equals(existing, value, StringComparison.Ordinal))
                    {
                        exists = true;
                        break;
                    }
                }
                if (!exists)
                {
                    target.Add(value);
                }
            }
        }
    }

    public sealed class BodyCenterlineAxisSystemCandidate
    {
        internal BodyCenterlineAxisSystemCandidate(
            BodyCenterlineAxisCandidate first,
            BodyCenterlineAxisCandidate second,
            double centerX,
            double centerY,
            double score,
            double extensionDistance)
        {
            FirstAxis = first;
            SecondAxis = second;
            CenterX = centerX;
            CenterY = centerY;
            Score = score;
            ExtensionDistance = extensionDistance;
            Confidence = first.HasExplicitModelEvidence || second.HasExplicitModelEvidence
                ? "supported_by_explicit_model_evidence"
                : "strong_geometric_candidate";
        }

        public string Id { get; internal set; }
        public BodyCenterlineAxisCandidate FirstAxis { get; private set; }
        public BodyCenterlineAxisCandidate SecondAxis { get; private set; }
        public double CenterX { get; private set; }
        public double CenterY { get; private set; }
        public double Score { get; private set; }
        public double ExtensionDistance { get; private set; }
        public string Confidence { get; private set; }

        internal Dictionary<string, object> ToMap()
        {
            return BodyCenterlineMaps.Map(
                "id", Id,
                "frame_id", FirstAxis.FrameId,
                "center", new[] { CenterX, CenterY },
                "axis_ids", new[] { FirstAxis.Id, SecondAxis.Id },
                "confidence", Confidence,
                "score", Score,
                "intersection_extension_distance", ExtensionDistance);
        }
    }

    public sealed class BodyCenterlineAnalysisDocument
    {
        internal BodyCenterlineAnalysisDocument(string drawingId, int frameCount)
        {
            DrawingId = drawingId ?? "";
            FrameCount = frameCount;
            LayerEvidence = new List<BodyCenterlineLayerEvidence>();
            TextMentions = new List<BodyCenterlineTextObservation>();
            AxisCandidates = new List<BodyCenterlineAxisCandidate>();
            AxisSystemCandidates = new List<BodyCenterlineAxisSystemCandidate>();
        }

        public string DrawingId { get; private set; }
        public int FrameCount { get; private set; }
        public IList<BodyCenterlineLayerEvidence> LayerEvidence { get; private set; }
        public IList<BodyCenterlineTextObservation> TextMentions { get; private set; }
        public IList<BodyCenterlineAxisCandidate> AxisCandidates { get; private set; }
        public IList<BodyCenterlineAxisSystemCandidate> AxisSystemCandidates { get; private set; }
        public string HighestRankedAxisSystemCandidateId { get; internal set; }

        public bool HasExplicitModelEvidence
        {
            get
            {
                foreach (BodyCenterlineAxisCandidate axis in AxisCandidates)
                {
                    if (axis.HasExplicitModelEvidence)
                    {
                        return true;
                    }
                }
                return false;
            }
        }

        public Dictionary<string, object> ToMap()
        {
            var layers = new List<Dictionary<string, object>>();
            foreach (BodyCenterlineLayerEvidence layer in LayerEvidence)
            {
                layers.Add(layer.ToMap());
            }
            var mentions = new List<Dictionary<string, object>>();
            foreach (BodyCenterlineTextObservation mention in TextMentions)
            {
                mentions.Add(BodyCenterlineMaps.Map(
                    "handle", mention.Handle,
                    "layer", mention.Layer,
                    "text", mention.Text,
                    "bbox", BodyCenterlineMaps.Map(
                        "min", new[] { mention.MinX, mention.MinY },
                        "max", new[] { mention.MaxX, mention.MaxY })));
            }
            var axes = new List<Dictionary<string, object>>();
            foreach (BodyCenterlineAxisCandidate axis in AxisCandidates)
            {
                axes.Add(axis.ToMap());
            }
            var systems = new List<Dictionary<string, object>>();
            foreach (BodyCenterlineAxisSystemCandidate system in AxisSystemCandidates)
            {
                systems.Add(system.ToMap());
            }

            string status = HasExplicitModelEvidence
                ? "explicit_model_evidence_found"
                : (AxisCandidates.Count > 0
                    ? "geometric_candidates_only"
                    : "not_detected");
            return BodyCenterlineMaps.Map(
                "schema_version", "1",
                "analysis_type", "body_centerline",
                "analyzer", "body_centerline_analyzer",
                "analyzer_version", "1",
                "drawing_id", DrawingId,
                "status", status,
                "frame_count", FrameCount,
                "has_explicit_model_evidence", HasExplicitModelEvidence,
                "highest_ranked_axis_system_candidate_id", HighestRankedAxisSystemCandidateId,
                "centerline_layer_evidence", layers,
                "explicit_text_mentions", mentions,
                "axis_candidate_count", AxisCandidates.Count,
                "axis_system_candidate_count", AxisSystemCandidates.Count,
                "axis_candidates", axes,
                "axis_system_candidates", systems,
                "interpretation_warning",
                    "generic centerline geometry is not automatically a semantically confirmed body centerline",
                "future_uses", new[]
                {
                    "classify_entities_by_axis_side",
                    "reflect_points_or_geometry_across_axis",
                    "search_for_symmetric_topology",
                    "transfer_semantic_labels_to_verified_symmetric_counterparts"
                },
                "limits", new[]
                {
                    "seven_sample_drawings_do_not_define_a_universal_rule",
                    "model_space_line_entities_only_for_axis_candidates",
                    "long_centerline_layer_or_center_linetype_segments",
                    "block_definition_transforms_are_not_expanded",
                    "geometric_candidates_require_later_semantic_or_symmetry_confirmation"
                });
        }

        public string ToMarkdown()
        {
            var markdown = new StringBuilder();
            markdown.AppendLine("# 器身中心线分析");
            markdown.AppendLine();
            markdown.Append("图纸：`");
            markdown.Append((DrawingId ?? "").Replace("`", "\\`"));
            markdown.AppendLine("`");
            markdown.AppendLine();
            if (AxisCandidates.Count == 0)
            {
                markdown.AppendLine("未检测到满足当前证据条件的模型空间中心线候选。");
            }
            else if (HasExplicitModelEvidence)
            {
                markdown.AppendLine("检测到带显式“器身中心线”模型空间证据的轴候选。");
            }
            else
            {
                markdown.AppendLine("检测到几何中心线候选，但尚无文字或专用图层与模型空间线的直接绑定，不能自动盖章为器身中心线。");
            }

            markdown.AppendLine();
            markdown.AppendLine("## 证据核对");
            markdown.AppendLine();
            if (LayerEvidence.Count == 0)
            {
                markdown.AppendLine("- 未找到名称或线型符合当前配置的中心线图层。");
            }
            else
            {
                foreach (BodyCenterlineLayerEvidence evidence in LayerEvidence)
                {
                    markdown.Append("- 图层 `");
                    markdown.Append(EscapeInline(evidence.Layer.Name));
                    markdown.Append("`（线型 `");
                    markdown.Append(EscapeInline(evidence.Layer.Linetype));
                    markdown.Append("`）：模型空间 Line ");
                    markdown.Append(evidence.ModelSpaceLineCount.ToString(CultureInfo.InvariantCulture));
                    markdown.Append("，块定义 Line ");
                    markdown.Append(evidence.BlockDefinitionLineCount.ToString(CultureInfo.InvariantCulture));
                    if (evidence.ExplicitName)
                    {
                        markdown.Append("，层名显式包含“器身中心线”");
                    }
                    markdown.AppendLine("。");
                }
            }
            if (TextMentions.Count == 0)
            {
                markdown.AppendLine("- 模型空间文字中未找到“器身中心线”。");
            }
            else
            {
                foreach (BodyCenterlineTextObservation mention in TextMentions)
                {
                    markdown.Append("- 文字句柄 `");
                    markdown.Append(EscapeInline(mention.Handle));
                    markdown.Append("`：");
                    markdown.Append(EscapeInline(mention.Text));
                    markdown.AppendLine("（只记录；靠近候选线时才形成直接证据）。");
                }
            }

            markdown.AppendLine();
            markdown.AppendLine("## 轴候选");
            markdown.AppendLine();
            foreach (BodyCenterlineAxisCandidate axis in AxisCandidates)
            {
                markdown.Append("- `");
                markdown.Append(axis.Id);
                markdown.Append("`：层 `");
                markdown.Append(EscapeInline(JoinInline(axis.SourceLayers)));
                markdown.Append("`，(");
                markdown.Append(Format(axis.StartX));
                markdown.Append(", ");
                markdown.Append(Format(axis.StartY));
                markdown.Append(") → (");
                markdown.Append(Format(axis.EndX));
                markdown.Append(", ");
                markdown.Append(Format(axis.EndY));
                markdown.Append(")，角度 ");
                markdown.Append(Format(axis.OrientationDegrees));
                markdown.Append("°，图框跨度比 ");
                markdown.Append(Format(axis.FrameSpanRatio));
                markdown.Append("，参与轴系 ");
                markdown.Append(axis.AxisSystemCount.ToString(CultureInfo.InvariantCulture));
                markdown.Append(" 个，源句柄 `");
                markdown.Append(EscapeInline(JoinInline(axis.SourceHandles)));
                markdown.Append("`");
                markdown.AppendLine("。");
            }

            markdown.AppendLine();
            markdown.AppendLine("## 正交轴系候选");
            markdown.AppendLine();
            if (AxisSystemCandidates.Count == 0)
            {
                markdown.AppendLine("- 无；当前只有独立轴候选。");
            }
            else
            {
                foreach (BodyCenterlineAxisSystemCandidate system in AxisSystemCandidates)
                {
                    markdown.Append("- `");
                    markdown.Append(system.Id);
                    markdown.Append("`：中心 (");
                    markdown.Append(Format(system.CenterX));
                    markdown.Append(", ");
                    markdown.Append(Format(system.CenterY));
                    markdown.Append(")，轴 `");
                    markdown.Append(system.FirstAxis.Id);
                    markdown.Append("` + `");
                    markdown.Append(system.SecondAxis.Id);
                    markdown.Append("`，");
                    markdown.AppendLine(system.Confidence + "。");
                }
            }

            markdown.AppendLine();
            markdown.AppendLine("> 注意：七图只能验证当前候选规则。后续以轴做法兰等语义镜像前，仍需用标注、拓扑相似度或人工确认把候选升级为已确认器身轴。");
            return markdown.ToString();
        }

        static string Format(double value)
        {
            return value.ToString("0.###", CultureInfo.InvariantCulture);
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

        static string EscapeInline(string value)
        {
            return (value ?? "")
                .Replace("\r", " ")
                .Replace("\n", " ")
                .Replace("`", "\\`");
        }
    }

    public static class BodyCenterlineAnalyzer
    {
        public static BodyCenterlineAnalysisDocument Analyze(
            string drawingId,
            IList<BodyCenterlineFrameBounds> frames,
            IList<BodyCenterlineLayerObservation> layers,
            IList<BodyCenterlineLineObservation> lines,
            IList<BodyCenterlineTextObservation> texts,
            BodyCenterlineAnalysisConfig config = null)
        {
            if (frames == null)
            {
                throw new ArgumentNullException("frames");
            }
            if (layers == null)
            {
                throw new ArgumentNullException("layers");
            }
            if (lines == null)
            {
                throw new ArgumentNullException("lines");
            }
            if (texts == null)
            {
                throw new ArgumentNullException("texts");
            }
            config = config ?? new BodyCenterlineAnalysisConfig();
            Validate(config);

            var document = new BodyCenterlineAnalysisDocument(drawingId, frames.Count);
            var layerByName = new Dictionary<string, BodyCenterlineLayerObservation>(
                StringComparer.OrdinalIgnoreCase);
            var evidenceByName = new Dictionary<string, BodyCenterlineLayerEvidence>(
                StringComparer.OrdinalIgnoreCase);
            foreach (BodyCenterlineLayerObservation layer in layers)
            {
                if (layer == null || string.IsNullOrEmpty(layer.Name))
                {
                    continue;
                }
                layerByName[layer.Name] = layer;
                if (IsCenterlineLayer(layer, config))
                {
                    var evidence = new BodyCenterlineLayerEvidence(
                        layer,
                        Contains(layer.Name, config.ExplicitLayerMarker));
                    evidenceByName[layer.Name] = evidence;
                    document.LayerEvidence.Add(evidence);
                }
            }

            foreach (BodyCenterlineLineObservation line in lines)
            {
                if (line == null)
                {
                    continue;
                }
                BodyCenterlineLayerEvidence layerEvidence;
                if (evidenceByName.TryGetValue(line.Layer, out layerEvidence))
                {
                    if (string.Equals(line.OwnerScope, "model_space", StringComparison.Ordinal))
                    {
                        layerEvidence.ModelSpaceLineCount++;
                    }
                    else if (string.Equals(line.OwnerScope, "block_definition", StringComparison.Ordinal))
                    {
                        layerEvidence.BlockDefinitionLineCount++;
                    }
                }
            }

            foreach (BodyCenterlineTextObservation text in texts)
            {
                if (text != null
                    && string.Equals(text.OwnerScope, "model_space", StringComparison.Ordinal)
                    && Contains(text.Text, config.TextMarker))
                {
                    document.TextMentions.Add(text);
                }
            }

            var raw = new List<BodyCenterlineAxisCandidate>();
            foreach (BodyCenterlineLineObservation line in lines)
            {
                if (line == null
                    || !string.Equals(line.OwnerScope, "model_space", StringComparison.Ordinal)
                    || line.Length <= 0)
                {
                    continue;
                }
                BodyCenterlineLayerObservation layer;
                if (!layerByName.TryGetValue(line.Layer, out layer)
                    || !IsCenterlineLayer(layer, config))
                {
                    continue;
                }
                foreach (BodyCenterlineFrameBounds frame in frames)
                {
                    if (frame == null || frame.Diagonal <= 0 || !frame.Intersects(line))
                    {
                        continue;
                    }
                    bool explicitLayer = Contains(layer.Name, config.ExplicitLayerMarker);
                    var evidence = new List<string>();
                    if (explicitLayer)
                    {
                        evidence.Add("layer_name_contains_body_centerline");
                    }
                    if (Contains(layer.Name, config.GenericLayerMarker))
                    {
                        evidence.Add("layer_name_contains_centerline");
                    }
                    if (ContainsIgnoreCase(layer.Linetype, config.CenterLinetypeMarker))
                    {
                        evidence.Add("layer_linetype_contains_center");
                    }
                    var candidate = new BodyCenterlineAxisCandidate(
                        frame.FrameId,
                        line,
                        0,
                        explicitLayer,
                        evidence);
                    candidate.FrameSpanRatio = candidate.SpanRatio(frame);
                    double minimum = explicitLayer
                        ? config.ExplicitMinimumFrameSpanRatio
                        : config.MinimumFrameSpanRatio;
                    if (candidate.FrameSpanRatio >= minimum)
                    {
                        raw.Add(candidate);
                    }
                    break;
                }
            }
            raw.Sort(CompareAxisLength);

            foreach (BodyCenterlineAxisCandidate candidate in raw)
            {
                BodyCenterlineFrameBounds frame = FindFrame(frames, candidate.FrameId);
                double diagonal = frame == null ? 1 : frame.Diagonal;
                BodyCenterlineAxisCandidate equivalent = null;
                foreach (BodyCenterlineAxisCandidate existing in document.AxisCandidates)
                {
                    if (existing.IsEquivalent(
                        candidate,
                        config.CollinearAngleToleranceDegrees,
                        diagonal * config.CollinearDistanceRatio,
                        diagonal * config.CollinearMergeGapRatio))
                    {
                        equivalent = existing;
                        break;
                    }
                }
                if (equivalent == null)
                {
                    document.AxisCandidates.Add(candidate);
                }
                else
                {
                    equivalent.Merge(candidate, frame);
                }
            }
            SortAxes(document.AxisCandidates);
            for (int index = 0; index < document.AxisCandidates.Count; index++)
            {
                document.AxisCandidates[index].Id = "body-centerline-axis-candidate-"
                    + (index + 1).ToString(CultureInfo.InvariantCulture);
            }

            AttachNearbyText(document, frames, config);
            BuildAxisSystems(document, frames, config);
            return document;
        }

        static void AttachNearbyText(
            BodyCenterlineAnalysisDocument document,
            IList<BodyCenterlineFrameBounds> frames,
            BodyCenterlineAnalysisConfig config)
        {
            foreach (BodyCenterlineAxisCandidate axis in document.AxisCandidates)
            {
                BodyCenterlineFrameBounds frame = FindFrame(frames, axis.FrameId);
                double maximumDistance = (frame == null ? 1 : frame.Diagonal)
                    * config.NearbyTextDistanceRatio;
                foreach (BodyCenterlineTextObservation mention in document.TextMentions)
                {
                    if (axis.DistanceToSegment(mention.CenterX, mention.CenterY) <= maximumDistance)
                    {
                        axis.NearbyTextMentionHandles.Add(mention.Handle);
                        if (!ContainsValue(axis.Evidence, "nearby_body_centerline_text"))
                        {
                            axis.Evidence.Add("nearby_body_centerline_text");
                        }
                    }
                }
            }
        }

        static void BuildAxisSystems(
            BodyCenterlineAnalysisDocument document,
            IList<BodyCenterlineFrameBounds> frames,
            BodyCenterlineAnalysisConfig config)
        {
            for (int firstIndex = 0; firstIndex < document.AxisCandidates.Count; firstIndex++)
            {
                BodyCenterlineAxisCandidate first = document.AxisCandidates[firstIndex];
                for (int secondIndex = firstIndex + 1;
                    secondIndex < document.AxisCandidates.Count;
                    secondIndex++)
                {
                    BodyCenterlineAxisCandidate second = document.AxisCandidates[secondIndex];
                    if (!string.Equals(first.FrameId, second.FrameId, StringComparison.Ordinal))
                    {
                        continue;
                    }
                    double difference = ParallelAngleDifference(
                        first.OrientationDegrees,
                        second.OrientationDegrees);
                    if (Math.Abs(90.0 - difference) > config.OrthogonalToleranceDegrees)
                    {
                        continue;
                    }
                    double x;
                    double y;
                    if (!TryIntersection(first, second, out x, out y))
                    {
                        continue;
                    }
                    BodyCenterlineFrameBounds frame = FindFrame(frames, first.FrameId);
                    double diagonal = frame == null ? 1 : frame.Diagonal;
                    double firstDistance = first.DistanceToSegment(x, y);
                    double secondDistance = second.DistanceToSegment(x, y);
                    double extension = Math.Max(firstDistance, secondDistance);
                    if (extension > diagonal * config.IntersectionExtensionRatio
                        || (frame != null
                            && !frame.Contains(x, y, diagonal * config.IntersectionExtensionRatio)))
                    {
                        continue;
                    }
                    double score = first.FrameSpanRatio + second.FrameSpanRatio
                        + (first.HasExplicitModelEvidence ? 1.0 : 0)
                        + (second.HasExplicitModelEvidence ? 1.0 : 0)
                        - extension / diagonal;
                    var system = new BodyCenterlineAxisSystemCandidate(
                        first,
                        second,
                        x,
                        y,
                        score,
                        extension);
                    document.AxisSystemCandidates.Add(system);
                    first.AxisSystemCount++;
                    second.AxisSystemCount++;
                }
            }
            SortSystems(document.AxisSystemCandidates);
            for (int index = 0; index < document.AxisSystemCandidates.Count; index++)
            {
                document.AxisSystemCandidates[index].Id = "body-centerline-axis-system-candidate-"
                    + (index + 1).ToString(CultureInfo.InvariantCulture);
            }
            if (document.AxisSystemCandidates.Count > 0)
            {
                document.HighestRankedAxisSystemCandidateId = document.AxisSystemCandidates[0].Id;
            }
        }

        static bool IsCenterlineLayer(
            BodyCenterlineLayerObservation layer,
            BodyCenterlineAnalysisConfig config)
        {
            return Contains(layer.Name, config.ExplicitLayerMarker)
                || Contains(layer.Name, config.GenericLayerMarker)
                || ContainsIgnoreCase(layer.Linetype, config.CenterLinetypeMarker);
        }

        static bool TryIntersection(
            BodyCenterlineAxisCandidate first,
            BodyCenterlineAxisCandidate second,
            out double x,
            out double y)
        {
            x = 0;
            y = 0;
            double denominator = Cross(
                first.UnitX,
                first.UnitY,
                second.UnitX,
                second.UnitY);
            if (Math.Abs(denominator) < 1e-12)
            {
                return false;
            }
            double offsetX = second.StartX - first.StartX;
            double offsetY = second.StartY - first.StartY;
            double distance = Cross(offsetX, offsetY, second.UnitX, second.UnitY)
                / denominator;
            x = first.StartX + distance * first.UnitX;
            y = first.StartY + distance * first.UnitY;
            return true;
        }

        static double Cross(double x1, double y1, double x2, double y2)
        {
            return x1 * y2 - y1 * x2;
        }

        static double ParallelAngleDifference(double left, double right)
        {
            double difference = Math.Abs(left - right) % 180.0;
            return Math.Min(difference, 180.0 - difference);
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

        static bool ContainsValue(IList<string> values, string value)
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

        static BodyCenterlineFrameBounds FindFrame(
            IList<BodyCenterlineFrameBounds> frames,
            string frameId)
        {
            foreach (BodyCenterlineFrameBounds frame in frames)
            {
                if (frame != null
                    && string.Equals(frame.FrameId, frameId, StringComparison.Ordinal))
                {
                    return frame;
                }
            }
            return null;
        }

        static int CompareAxisLength(
            BodyCenterlineAxisCandidate left,
            BodyCenterlineAxisCandidate right)
        {
            return right.Length.CompareTo(left.Length);
        }

        static void SortAxes(IList<BodyCenterlineAxisCandidate> axes)
        {
            var list = axes as List<BodyCenterlineAxisCandidate>;
            if (list != null)
            {
                list.Sort(CompareAxisRank);
            }
        }

        static int CompareAxisRank(
            BodyCenterlineAxisCandidate left,
            BodyCenterlineAxisCandidate right)
        {
            int explicitEvidence = right.HasExplicitModelEvidence.CompareTo(left.HasExplicitModelEvidence);
            if (explicitEvidence != 0)
            {
                return explicitEvidence;
            }
            int span = right.FrameSpanRatio.CompareTo(left.FrameSpanRatio);
            return span != 0 ? span : right.Length.CompareTo(left.Length);
        }

        static void SortSystems(IList<BodyCenterlineAxisSystemCandidate> systems)
        {
            var list = systems as List<BodyCenterlineAxisSystemCandidate>;
            if (list != null)
            {
                list.Sort(CompareSystemScore);
            }
        }

        static int CompareSystemScore(
            BodyCenterlineAxisSystemCandidate left,
            BodyCenterlineAxisSystemCandidate right)
        {
            return right.Score.CompareTo(left.Score);
        }

        static void Validate(BodyCenterlineAnalysisConfig config)
        {
            if (string.IsNullOrWhiteSpace(config.GenericLayerMarker)
                || string.IsNullOrWhiteSpace(config.CenterLinetypeMarker)
                || string.IsNullOrWhiteSpace(config.TextMarker))
            {
                throw new ArgumentException("Centerline markers must not be empty.", "config");
            }
            if (config.MinimumFrameSpanRatio <= 0
                || config.ExplicitMinimumFrameSpanRatio <= 0
                || config.CollinearAngleToleranceDegrees < 0
                || config.CollinearDistanceRatio < 0
                || config.CollinearMergeGapRatio < 0
                || config.OrthogonalToleranceDegrees < 0
                || config.IntersectionExtensionRatio < 0
                || config.NearbyTextDistanceRatio < 0)
            {
                throw new ArgumentOutOfRangeException("config");
            }
        }
    }

    internal static class BodyCenterlineMaps
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
