using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Shb.Cad.Core
{
    public sealed class AnnotationPointObservation
    {
        public AnnotationPointObservation(string role, double x, double y)
        {
            Role = role ?? "";
            X = x;
            Y = y;
        }

        public string Role { get; private set; }
        public double X { get; private set; }
        public double Y { get; private set; }

        internal Dictionary<string, object> ToMap()
        {
            return AnnotationMaps.Map("role", Role, "point", new[] { X, Y });
        }
    }

    public sealed class AnnotationEntityObservation
    {
        readonly List<AnnotationPointObservation> geometryPoints;

        public AnnotationEntityObservation(
            string handle,
            string runtimeClass,
            string managedType,
            string layer,
            int colorIndex,
            string ownerScope,
            string ownerBlockName,
            string geometryKind)
        {
            Handle = handle ?? "";
            RuntimeClass = runtimeClass ?? "";
            ManagedType = managedType ?? "";
            Layer = layer ?? "";
            ColorIndex = colorIndex;
            OwnerScope = ownerScope ?? "";
            OwnerBlockName = ownerBlockName ?? "";
            GeometryKind = geometryKind ?? "";
            Text = "";
            DimensionSubtype = "";
            DimensionText = "";
            DimensionStyle = "";
            geometryPoints = new List<AnnotationPointObservation>();
        }

        public string Handle { get; private set; }
        public string RuntimeClass { get; private set; }
        public string ManagedType { get; private set; }
        public string Layer { get; private set; }
        public int ColorIndex { get; private set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public string GeometryKind { get; private set; }
        public string Text { get; private set; }
        public bool HasBounds { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }
        public bool HasMeasurement { get; private set; }
        public double Measurement { get; private set; }
        public string DimensionSubtype { get; private set; }
        public string DimensionText { get; private set; }
        public string DimensionStyle { get; private set; }
        public bool HasArrowHeadValue { get; private set; }
        public bool HasArrowHead { get; private set; }
        public IList<AnnotationPointObservation> GeometryPoints
        {
            get { return geometryPoints.AsReadOnly(); }
        }

        public AnnotationEntityObservation SetBounds(
            double minX,
            double minY,
            double maxX,
            double maxY)
        {
            if (!double.IsNaN(minX)
                && !double.IsNaN(minY)
                && !double.IsNaN(maxX)
                && !double.IsNaN(maxY))
            {
                HasBounds = true;
                MinX = Math.Min(minX, maxX);
                MinY = Math.Min(minY, maxY);
                MaxX = Math.Max(minX, maxX);
                MaxY = Math.Max(minY, maxY);
            }
            return this;
        }

        public AnnotationEntityObservation SetText(string value)
        {
            Text = value ?? "";
            return this;
        }

        public AnnotationEntityObservation SetDimension(
            string subtype,
            double? measurement,
            string dimensionText,
            string dimensionStyle)
        {
            DimensionSubtype = subtype ?? "";
            DimensionText = dimensionText ?? "";
            DimensionStyle = dimensionStyle ?? "";
            if (measurement.HasValue
                && !double.IsNaN(measurement.Value)
                && !double.IsInfinity(measurement.Value))
            {
                HasMeasurement = true;
                Measurement = measurement.Value;
            }
            return this;
        }

        public AnnotationEntityObservation SetHasArrowHead(bool value)
        {
            HasArrowHeadValue = true;
            HasArrowHead = value;
            return this;
        }

        public AnnotationEntityObservation AddGeometryPoint(string role, double x, double y)
        {
            if (!double.IsNaN(x)
                && !double.IsNaN(y)
                && !double.IsInfinity(x)
                && !double.IsInfinity(y))
            {
                geometryPoints.Add(new AnnotationPointObservation(role, x, y));
            }
            return this;
        }

        internal AnnotationPointObservation Point(string role)
        {
            foreach (AnnotationPointObservation point in geometryPoints)
            {
                if (string.Equals(point.Role, role, StringComparison.Ordinal))
                {
                    return point;
                }
            }
            return null;
        }

        internal double CenterX { get { return HasBounds ? (MinX + MaxX) / 2.0 : 0; } }
        internal double CenterY { get { return HasBounds ? (MinY + MaxY) / 2.0 : 0; } }
        internal double Width { get { return HasBounds ? MaxX - MinX : 0; } }
        internal double Height { get { return HasBounds ? MaxY - MinY : 0; } }
    }

    public sealed class AnnotationIdentificationConfig
    {
        public AnnotationIdentificationConfig()
        {
            GeometryTolerance = 0.01;
            ArrowAxisToleranceDegrees = 5.0;
            MaximumSolidToShaftRatio = 2.5;
            DirectionTextDistanceFactor = 2.25;
            DirectionLabelPattern = "^[A-Z]$";
        }

        public double GeometryTolerance { get; set; }
        public double ArrowAxisToleranceDegrees { get; set; }
        public double MaximumSolidToShaftRatio { get; set; }
        public double DirectionTextDistanceFactor { get; set; }
        public string DirectionLabelPattern { get; set; }
    }

    public sealed class AnnotationRecord
    {
        readonly List<string> sourceHandles;
        readonly List<string> removalCandidateHandles;
        readonly List<string> evidence;
        readonly List<AnnotationPointObservation> geometryPoints;

        internal AnnotationRecord(
            string id,
            string type,
            string subtype,
            AnnotationEntityObservation source,
            string displayText,
            double confidence,
            string semanticStatus,
            string meaningStatus,
            string removalScope)
        {
            Id = id ?? "";
            Type = type ?? "";
            Subtype = subtype ?? "";
            DisplayText = displayText ?? "";
            Confidence = confidence;
            SemanticStatus = semanticStatus ?? "";
            MeaningStatus = meaningStatus ?? "";
            RemovalScope = removalScope ?? "";
            sourceHandles = new List<string>();
            removalCandidateHandles = new List<string>();
            evidence = new List<string>();
            geometryPoints = new List<AnnotationPointObservation>();
            DirectionX = double.NaN;
            DirectionY = double.NaN;

            if (source != null)
            {
                Layer = source.Layer;
                OwnerScope = source.OwnerScope;
                OwnerBlockName = source.OwnerBlockName;
                RuntimeClass = source.RuntimeClass;
                HasBounds = source.HasBounds;
                MinX = source.MinX;
                MinY = source.MinY;
                MaxX = source.MaxX;
                MaxY = source.MaxY;
                DimensionStyle = source.DimensionStyle;
                DimensionTextOverride = source.DimensionText;
                if (source.HasMeasurement)
                {
                    HasMeasurement = true;
                    Measurement = source.Measurement;
                }
                foreach (AnnotationPointObservation point in source.GeometryPoints)
                {
                    geometryPoints.Add(point);
                }
                AddHandle(source.Handle);
            }
        }

        public string Id { get; private set; }
        public string Type { get; private set; }
        public string Subtype { get; private set; }
        public string DisplayText { get; private set; }
        public string Layer { get; private set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public string RuntimeClass { get; private set; }
        public double Confidence { get; private set; }
        public string SemanticStatus { get; private set; }
        public string MeaningStatus { get; private set; }
        public string RemovalScope { get; private set; }
        public bool HasBounds { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }
        public bool HasMeasurement { get; private set; }
        public double Measurement { get; private set; }
        public string DimensionTextOverride { get; private set; }
        public string DimensionStyle { get; private set; }
        public double DirectionX { get; private set; }
        public double DirectionY { get; private set; }
        public IList<string> SourceHandles { get { return sourceHandles.AsReadOnly(); } }
        public IList<string> RemovalCandidateHandles
        {
            get { return removalCandidateHandles.AsReadOnly(); }
        }
        public IList<string> Evidence { get { return evidence.AsReadOnly(); } }
        public IList<AnnotationPointObservation> GeometryPoints
        {
            get { return geometryPoints.AsReadOnly(); }
        }

        internal void AddHandle(string handle)
        {
            if (string.IsNullOrEmpty(handle) || sourceHandles.Contains(handle))
            {
                return;
            }
            sourceHandles.Add(handle);
            removalCandidateHandles.Add(handle);
        }

        internal void AddEvidence(string value)
        {
            if (!string.IsNullOrEmpty(value) && !evidence.Contains(value))
            {
                evidence.Add(value);
            }
        }

        internal void AddPoint(string role, double x, double y)
        {
            geometryPoints.Add(new AnnotationPointObservation(role, x, y));
        }

        internal void SetDirection(double x, double y)
        {
            DirectionX = x;
            DirectionY = y;
        }

        internal void UnionBounds(AnnotationEntityObservation observation)
        {
            if (observation == null || !observation.HasBounds)
            {
                return;
            }
            if (!HasBounds)
            {
                HasBounds = true;
                MinX = observation.MinX;
                MinY = observation.MinY;
                MaxX = observation.MaxX;
                MaxY = observation.MaxY;
                return;
            }
            MinX = Math.Min(MinX, observation.MinX);
            MinY = Math.Min(MinY, observation.MinY);
            MaxX = Math.Max(MaxX, observation.MaxX);
            MaxY = Math.Max(MaxY, observation.MaxY);
        }

        public Dictionary<string, object> ToMap()
        {
            var points = new List<Dictionary<string, object>>();
            foreach (AnnotationPointObservation point in geometryPoints)
            {
                points.Add(point.ToMap());
            }
            return AnnotationMaps.Map(
                "id", Id,
                "annotation_type", Type,
                "annotation_subtype", Subtype,
                "display_text", DisplayText,
                "measurement", HasMeasurement ? (object)Measurement : null,
                "dimension_text_override", DimensionTextOverride,
                "dimension_style", DimensionStyle,
                "layer", Layer,
                "owner_scope", OwnerScope,
                "owner_block_name", OwnerBlockName,
                "runtime_class", RuntimeClass,
                "bbox", HasBounds
                    ? (object)AnnotationMaps.Map(
                        "min", new[] { MinX, MinY },
                        "max", new[] { MaxX, MaxY })
                    : null,
                "geometry_points", points,
                "direction", double.IsNaN(DirectionX)
                    ? null
                    : (object)new[] { DirectionX, DirectionY },
                "source_handles", new List<string>(sourceHandles),
                "removal_candidate_handles", new List<string>(removalCandidateHandles),
                "removal_scope", RemovalScope,
                "confidence", Confidence,
                "semantic_status", SemanticStatus,
                "meaning_status", MeaningStatus,
                "evidence", new List<string>(evidence));
        }
    }

    public sealed class AnnotationIdentificationDocument
    {
        readonly List<AnnotationRecord> annotations;
        readonly Dictionary<string, int> typeCounts;
        readonly List<string> removalCandidateHandles;

        internal AnnotationIdentificationDocument(
            string drawingId,
            IList<AnnotationRecord> records)
        {
            DrawingId = drawingId ?? "";
            annotations = new List<AnnotationRecord>();
            typeCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            removalCandidateHandles = new List<string>();
            var seenHandles = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            if (records == null)
            {
                return;
            }
            foreach (AnnotationRecord record in records)
            {
                if (record == null)
                {
                    continue;
                }
                annotations.Add(record);
                int count;
                typeCounts.TryGetValue(record.Type, out count);
                typeCounts[record.Type] = count + 1;
                foreach (string handle in record.RemovalCandidateHandles)
                {
                    if (seenHandles.Add(handle))
                    {
                        removalCandidateHandles.Add(handle);
                    }
                }
            }
        }

        public string DrawingId { get; private set; }
        public IList<AnnotationRecord> Annotations { get { return annotations.AsReadOnly(); } }
        public IDictionary<string, int> TypeCounts
        {
            get { return new Dictionary<string, int>(typeCounts, StringComparer.Ordinal); }
        }
        public IList<string> RemovalCandidateHandles
        {
            get { return removalCandidateHandles.AsReadOnly(); }
        }
        public int Count { get { return annotations.Count; } }

        public int CountOf(string type)
        {
            int value;
            return typeCounts.TryGetValue(type ?? "", out value) ? value : 0;
        }

        public Dictionary<string, object> ToMap()
        {
            var records = new List<Dictionary<string, object>>();
            foreach (AnnotationRecord record in annotations)
            {
                records.Add(record.ToMap());
            }
            return AnnotationMaps.Map(
                "schema_version", "1",
                "analysis_type", "annotation_identification",
                "identifier_version", "1",
                "drawing_id", DrawingId,
                "annotation_count", Count,
                "annotation_type_counts", new Dictionary<string, int>(
                    typeCounts,
                    StringComparer.Ordinal),
                "removal_candidate_handle_count", removalCandidateHandles.Count,
                "removal_candidate_handles", new List<string>(removalCandidateHandles),
                "overlap_policy", "independent_capability_results_may_overlap",
                "deletion_status", "recognition_only_no_entities_modified",
                "scope", AnnotationMaps.Map(
                    "included", new[]
                    {
                        "native_dimensions",
                        "leaders_and_multileaders",
                        "TH_XuHaoEntity",
                        "TH_DimRough*",
                        "TH_ParaBasePntUA",
                        "TH_CVArrowLine",
                        "Line+Solid+single-letter-text direction-marker topology"
                    },
                    "standalone_text_policy",
                        "not_annotation_unless_bound_to_an_annotation_topology"),
                "limitations", new[]
                {
                    "P/Q is identified geometrically; its business meaning remains unresolved.",
                    "TH_ParaBasePntUA visible letter/value is not exposed by the current decoder.",
                    "Removal handles are candidates for a later copy-based deletion workflow, not an erase command."
                },
                "annotations", records);
        }

        public string ToMarkdown()
        {
            var sb = new StringBuilder();
            sb.AppendLine("# 全图标注识别");
            sb.AppendLine();
            sb.AppendLine("- 图纸：`" + DrawingId + "`");
            sb.AppendLine("- 标注记录：" + Count.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("- 成组移除候选句柄："
                + removalCandidateHandles.Count.ToString(CultureInfo.InvariantCulture));
            sb.AppendLine("- 状态：只识别，未修改图纸");
            sb.AppendLine();
            sb.AppendLine("## 分类统计");
            sb.AppendLine();
            var keys = new List<string>(typeCounts.Keys);
            keys.Sort(StringComparer.Ordinal);
            foreach (string key in keys)
            {
                sb.AppendLine("- `" + key + "`："
                    + typeCounts[key].ToString(CultureInfo.InvariantCulture));
            }
            sb.AppendLine();
            sb.AppendLine("## 口径");
            sb.AppendLine();
            sb.AppendLine("中心线说明等文字引线不会因已被 07 使用而排除；08 与 04/07 可以重叠。");
            sb.AppendLine("普通散文字只有在与箭头等结构成组时才进入 08，避免把标题栏、明细表和技术要求误删。");
            sb.AppendLine("P/Q 当前只确认是 Line + Solid + DBText 的方向标记拓扑，业务含义保留为未解析。");
            return sb.ToString().TrimEnd();
        }
    }

    public static class AnnotationIdentifier
    {
        sealed class ArrowCandidate
        {
            public AnnotationEntityObservation Line;
            public AnnotationEntityObservation Solid;
            public AnnotationPointObservation Shared;
            public double DirectionX;
            public double DirectionY;
            public double ShaftLength;
        }

        sealed class DirectionMatch
        {
            public ArrowCandidate Arrow;
            public AnnotationEntityObservation Text;
            public double Score;
        }

        public static AnnotationIdentificationDocument Identify(
            string drawingId,
            IList<AnnotationEntityObservation> observations,
            AnnotationIdentificationConfig config = null)
        {
            config = config ?? new AnnotationIdentificationConfig();
            var sorted = new List<AnnotationEntityObservation>();
            if (observations != null)
            {
                foreach (AnnotationEntityObservation observation in observations)
                {
                    if (observation != null)
                    {
                        sorted.Add(observation);
                    }
                }
            }
            sorted.Sort(CompareObservation);

            var records = new List<AnnotationRecord>();
            foreach (AnnotationEntityObservation observation in sorted)
            {
                AnnotationRecord record = DirectRecord(observation);
                if (record != null)
                {
                    records.Add(record);
                }
            }
            foreach (AnnotationRecord record in FindDirectionMarkers(sorted, config))
            {
                records.Add(record);
            }
            return new AnnotationIdentificationDocument(drawingId, records);
        }

        static AnnotationRecord DirectRecord(AnnotationEntityObservation source)
        {
            string runtime = source.RuntimeClass;
            string managed = source.ManagedType;
            string kind = source.GeometryKind;
            string type = "";
            string subtype = "";
            string displayText = source.Text;
            double confidence = 1.0;
            string semanticStatus = "explicit_entity_type";
            string meaningStatus = "typed";

            if (string.Equals(kind, "dimension", StringComparison.Ordinal)
                || managed.EndsWith("Dimension", StringComparison.Ordinal))
            {
                type = "dimension";
                subtype = NormalizeDimensionSubtype(source.DimensionSubtype.Length == 0
                    ? managed
                    : source.DimensionSubtype);
                if (string.IsNullOrEmpty(displayText)
                    || string.Equals(displayText, "<>", StringComparison.Ordinal))
                {
                    displayText = source.HasMeasurement
                        ? source.Measurement.ToString("0.###############", CultureInfo.InvariantCulture)
                        : "";
                }
            }
            else if (string.Equals(runtime, "TH_XuHaoEntity", StringComparison.Ordinal))
            {
                type = "serial_balloon";
                subtype = "th_xuhao";
                meaningStatus = "serial_value_if_decoded";
            }
            else if (runtime.StartsWith("TH_DimRough", StringComparison.Ordinal))
            {
                type = "roughness_symbol";
                subtype = runtime;
                meaningStatus = "entity_type_only";
                confidence = 0.99;
            }
            else if (string.Equals(runtime, "TH_ParaBasePntUA", StringComparison.Ordinal))
            {
                type = "datum_reference_symbol";
                subtype = "th_parameter_base_point";
                semanticStatus = "explicit_entity_type_value_unavailable";
                meaningStatus = "visible_value_unresolved";
                confidence = 0.95;
            }
            else if (string.Equals(runtime, "TH_CVArrowLine", StringComparison.Ordinal))
            {
                type = "symbol_arrow";
                subtype = "th_cv_arrow_line";
                meaningStatus = "arrow_purpose_unresolved";
                confidence = 0.99;
            }
            else if (string.Equals(runtime, "TH_DimLeaderUA", StringComparison.Ordinal))
            {
                type = "text_leader";
                subtype = "th_dimension_leader";
                meaningStatus = string.IsNullOrEmpty(displayText)
                    ? "visible_text_unresolved"
                    : "text_preserved";
                confidence = 0.99;
            }
            else if (string.Equals(kind, "mleader", StringComparison.Ordinal)
                || string.Equals(managed, "MLeader", StringComparison.Ordinal))
            {
                type = "multileader";
                subtype = "acdb_mleader";
                meaningStatus = string.IsNullOrEmpty(displayText)
                    ? "content_unresolved"
                    : "text_preserved";
            }
            else if (string.Equals(kind, "leader", StringComparison.Ordinal)
                || string.Equals(managed, "Leader", StringComparison.Ordinal))
            {
                type = string.IsNullOrEmpty(displayText) ? "leader" : "text_leader";
                subtype = "acdb_leader";
                meaningStatus = string.IsNullOrEmpty(displayText)
                    ? "annotation_reference_unresolved"
                    : "text_preserved";
                confidence = string.IsNullOrEmpty(displayText) ? 0.95 : 1.0;
            }
            else
            {
                return null;
            }

            var record = new AnnotationRecord(
                "annotation:" + source.Handle,
                type,
                subtype,
                source,
                displayText,
                confidence,
                semanticStatus,
                meaningStatus,
                string.Equals(source.OwnerScope, "block_definition", StringComparison.Ordinal)
                    ? "single_entity_in_shared_block_definition"
                    : "single_entity");
            record.AddEvidence("runtime_class:" + runtime);
            if (!string.IsNullOrEmpty(kind))
            {
                record.AddEvidence("geometry_kind:" + kind);
            }
            if (source.HasMeasurement)
            {
                record.AddEvidence("measurement_from_dimension_entity");
            }
            if (!string.IsNullOrEmpty(source.Text))
            {
                record.AddEvidence("visible_text_preserved");
            }
            return record;
        }

        static IList<AnnotationRecord> FindDirectionMarkers(
            IList<AnnotationEntityObservation> observations,
            AnnotationIdentificationConfig config)
        {
            var lines = new List<AnnotationEntityObservation>();
            var solids = new List<AnnotationEntityObservation>();
            var texts = new List<AnnotationEntityObservation>();
            Regex labelPattern = new Regex(
                string.IsNullOrEmpty(config.DirectionLabelPattern)
                    ? "^[A-Z]$"
                    : config.DirectionLabelPattern,
                RegexOptions.CultureInvariant);
            foreach (AnnotationEntityObservation observation in observations)
            {
                if (string.Equals(observation.GeometryKind, "line", StringComparison.Ordinal))
                {
                    lines.Add(observation);
                }
                else if (string.Equals(observation.GeometryKind, "solid", StringComparison.Ordinal))
                {
                    solids.Add(observation);
                }
                else if ((string.Equals(observation.GeometryKind, "text", StringComparison.Ordinal)
                        || string.Equals(observation.GeometryKind, "mtext", StringComparison.Ordinal))
                    && labelPattern.IsMatch((observation.Text ?? "").Trim()))
                {
                    texts.Add(observation);
                }
            }

            var matches = new List<DirectionMatch>();
            foreach (AnnotationEntityObservation line in lines)
            {
                foreach (AnnotationEntityObservation solid in solids)
                {
                    ArrowCandidate arrow;
                    if (!TryArrow(line, solid, config, out arrow))
                    {
                        continue;
                    }
                    foreach (AnnotationEntityObservation text in texts)
                    {
                        if (!SameOwner(line, text) || !text.HasBounds)
                        {
                            continue;
                        }
                        double dx = text.CenterX - arrow.Shared.X;
                        double dy = text.CenterY - arrow.Shared.Y;
                        double distance = Math.Sqrt(dx * dx + dy * dy);
                        double scale = Math.Max(
                            arrow.ShaftLength,
                            Math.Max(
                                Math.Max(text.Width, text.Height),
                                Math.Sqrt(solid.Width * solid.Width + solid.Height * solid.Height)));
                        if (scale <= config.GeometryTolerance
                            || distance > scale * config.DirectionTextDistanceFactor)
                        {
                            continue;
                        }
                        matches.Add(new DirectionMatch
                        {
                            Arrow = arrow,
                            Text = text,
                            Score = distance / scale
                        });
                    }
                }
            }
            matches.Sort(delegate(DirectionMatch left, DirectionMatch right)
            {
                int score = left.Score.CompareTo(right.Score);
                if (score != 0)
                {
                    return score;
                }
                return string.CompareOrdinal(left.Text.Handle, right.Text.Handle);
            });

            var claimed = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var result = new List<AnnotationRecord>();
            foreach (DirectionMatch match in matches)
            {
                if (claimed.Contains(match.Arrow.Line.Handle)
                    || claimed.Contains(match.Arrow.Solid.Handle)
                    || claimed.Contains(match.Text.Handle))
                {
                    continue;
                }
                claimed.Add(match.Arrow.Line.Handle);
                claimed.Add(match.Arrow.Solid.Handle);
                claimed.Add(match.Text.Handle);
                var record = new AnnotationRecord(
                    "annotation:direction_marker:" + match.Text.Handle,
                    "direction_marker",
                    "lettered_filled_arrow",
                    match.Arrow.Line,
                    match.Text.Text.Trim(),
                    0.92,
                    "geometric_topology",
                    "business_meaning_unresolved",
                    string.Equals(match.Arrow.Line.OwnerScope, "block_definition", StringComparison.Ordinal)
                        ? "composite_candidate_in_shared_block_definition"
                        : "composite_complete_candidate");
                record.AddHandle(match.Arrow.Solid.Handle);
                record.AddHandle(match.Text.Handle);
                record.UnionBounds(match.Arrow.Solid);
                record.UnionBounds(match.Text);
                record.SetDirection(match.Arrow.DirectionX, match.Arrow.DirectionY);
                record.AddPoint("arrow_base", match.Arrow.Shared.X, match.Arrow.Shared.Y);
                record.AddEvidence("ordinary_entities:Line+Solid+DBText");
                record.AddEvidence("line_endpoint_touches_solid");
                record.AddEvidence("single_uppercase_label");
                record.AddEvidence("meaning_not_inferred_from_letter");
                result.Add(record);
            }
            return result;
        }

        static bool TryArrow(
            AnnotationEntityObservation line,
            AnnotationEntityObservation solid,
            AnnotationIdentificationConfig config,
            out ArrowCandidate arrow)
        {
            arrow = null;
            if (!SameOwner(line, solid)
                || !string.Equals(line.Layer, solid.Layer, StringComparison.OrdinalIgnoreCase)
                || (line.ColorIndex >= 0
                    && solid.ColorIndex >= 0
                    && line.ColorIndex != solid.ColorIndex)
                || !solid.HasBounds)
            {
                return false;
            }
            AnnotationPointObservation start = line.Point("start");
            AnnotationPointObservation end = line.Point("end");
            if (start == null || end == null)
            {
                return false;
            }
            double dx = end.X - start.X;
            double dy = end.Y - start.Y;
            double length = Math.Sqrt(dx * dx + dy * dy);
            if (length <= config.GeometryTolerance)
            {
                return false;
            }
            double axisCos = Math.Cos(config.ArrowAxisToleranceDegrees * Math.PI / 180.0);
            if (Math.Abs(dx / length) < axisCos && Math.Abs(dy / length) < axisCos)
            {
                return false;
            }
            double solidDiagonal = Math.Sqrt(
                solid.Width * solid.Width + solid.Height * solid.Height);
            if (solidDiagonal <= config.GeometryTolerance
                || Math.Max(solid.Width, solid.Height)
                    > length * config.MaximumSolidToShaftRatio)
            {
                return false;
            }
            double touchTolerance = Math.Max(
                config.GeometryTolerance,
                Math.Max(solid.Width, solid.Height) * 0.02);
            bool startInside = InsideExpanded(start, solid, touchTolerance);
            bool endInside = InsideExpanded(end, solid, touchTolerance);
            if (startInside == endInside)
            {
                return false;
            }
            AnnotationPointObservation shared = startInside ? start : end;
            AnnotationPointObservation outside = startInside ? end : start;
            double directionX = (shared.X - outside.X) / length;
            double directionY = (shared.Y - outside.Y) / length;
            double forward = MaximumForwardExtent(shared, directionX, directionY, solid);
            if (forward <= touchTolerance)
            {
                return false;
            }
            arrow = new ArrowCandidate
            {
                Line = line,
                Solid = solid,
                Shared = shared,
                DirectionX = directionX,
                DirectionY = directionY,
                ShaftLength = length
            };
            return true;
        }

        static bool InsideExpanded(
            AnnotationPointObservation point,
            AnnotationEntityObservation bounds,
            double tolerance)
        {
            return point.X >= bounds.MinX - tolerance
                && point.X <= bounds.MaxX + tolerance
                && point.Y >= bounds.MinY - tolerance
                && point.Y <= bounds.MaxY + tolerance;
        }

        static double MaximumForwardExtent(
            AnnotationPointObservation origin,
            double directionX,
            double directionY,
            AnnotationEntityObservation bounds)
        {
            double maximum = double.NegativeInfinity;
            double[] xs = { bounds.MinX, bounds.MaxX };
            double[] ys = { bounds.MinY, bounds.MaxY };
            foreach (double x in xs)
            {
                foreach (double y in ys)
                {
                    double projection = (x - origin.X) * directionX
                        + (y - origin.Y) * directionY;
                    maximum = Math.Max(maximum, projection);
                }
            }
            return maximum;
        }

        static bool SameOwner(
            AnnotationEntityObservation left,
            AnnotationEntityObservation right)
        {
            return string.Equals(left.OwnerScope, right.OwnerScope, StringComparison.Ordinal)
                && string.Equals(
                    left.OwnerBlockName,
                    right.OwnerBlockName,
                    StringComparison.Ordinal);
        }

        static string NormalizeDimensionSubtype(string value)
        {
            string name = value ?? "";
            if (name.EndsWith("Dimension", StringComparison.Ordinal))
            {
                name = name.Substring(0, name.Length - "Dimension".Length);
            }
            var sb = new StringBuilder();
            foreach (char character in name)
            {
                if (char.IsUpper(character) && sb.Length > 0)
                {
                    sb.Append('_');
                }
                sb.Append(char.ToLowerInvariant(character));
            }
            return sb.Length == 0 ? "unknown" : sb.ToString();
        }

        static int CompareObservation(
            AnnotationEntityObservation left,
            AnnotationEntityObservation right)
        {
            int owner = string.CompareOrdinal(left.OwnerScope, right.OwnerScope);
            if (owner != 0)
            {
                return owner;
            }
            int block = string.CompareOrdinal(left.OwnerBlockName, right.OwnerBlockName);
            return block != 0 ? block : string.CompareOrdinal(left.Handle, right.Handle);
        }
    }

    internal static class AnnotationMaps
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
