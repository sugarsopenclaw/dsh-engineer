using System;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace Shb.Cad.Core
{
    public sealed class SemanticDrawingSnapshotConfig
    {
        public SemanticDrawingSnapshotConfig()
        {
            SignatureCoordinateTolerance = 0.001;
            MaximumElementCount = 300000;
            MaximumGeometryOccurrenceCount = 200000;
            MaximumProfileCount = 60000;
            MaximumInterfaceRecordCount = 100000;
        }

        public double SignatureCoordinateTolerance { get; set; }
        public int MaximumElementCount { get; set; }
        public int MaximumGeometryOccurrenceCount { get; set; }
        public int MaximumProfileCount { get; set; }
        public int MaximumInterfaceRecordCount { get; set; }
    }

    public sealed class SemanticDrawingDiffConfig
    {
        public SemanticDrawingDiffConfig()
        {
            RequireComparableDrawingIdentity = true;
            AllowUnverifiedIdentity = false;
            AbsoluteCoordinateTolerance = 0.05;
            RelativeCoordinateTolerance = 0.000001;
            AbsoluteNumericTolerance = 0.000001;
            RelativeNumericTolerance = 0.000001;
            FallbackSpatialToleranceRatio = 0.0005;
            MinimumFallbackSpatialTolerance = 0.1;
            MatchTieToleranceRatio = 0.01;
            AlignmentToleranceRatio = 0.00001;
            MinimumAlignmentSupport = 3;
            MinimumAlignmentInlierRatio = 0.6;
            ChangeRegionGapRatio = 0.002;
            MaximumInputElementCountPerSnapshot = 300000;
            MaximumCandidateComparisonCount = 5000000;
            MaximumSynchronizationCandidateCount = 10000;
            MaximumChangeRegionCount = 10000;
        }

        public bool RequireComparableDrawingIdentity { get; set; }
        public bool AllowUnverifiedIdentity { get; set; }
        public double AbsoluteCoordinateTolerance { get; set; }
        public double RelativeCoordinateTolerance { get; set; }
        public double AbsoluteNumericTolerance { get; set; }
        public double RelativeNumericTolerance { get; set; }
        public double FallbackSpatialToleranceRatio { get; set; }
        public double MinimumFallbackSpatialTolerance { get; set; }
        public double MatchTieToleranceRatio { get; set; }
        public double AlignmentToleranceRatio { get; set; }
        public int MinimumAlignmentSupport { get; set; }
        public double MinimumAlignmentInlierRatio { get; set; }
        public double ChangeRegionGapRatio { get; set; }
        public int MaximumInputElementCountPerSnapshot { get; set; }
        public int MaximumCandidateComparisonCount { get; set; }
        public int MaximumSynchronizationCandidateCount { get; set; }
        public int MaximumChangeRegionCount { get; set; }
    }

    public sealed class SemanticDrawingIdentityObservation
    {
        readonly Dictionary<string, string> evidence;

        public SemanticDrawingIdentityObservation(string drawingId)
        {
            DrawingId = drawingId ?? "";
            evidence = new Dictionary<string, string>(StringComparer.Ordinal);
        }

        public string DrawingId { get; private set; }
        public string DrawingNumber { get; private set; }
        public string DrawingName { get; private set; }
        public string Revision { get; private set; }
        public string Stage { get; private set; }
        public string Sheet { get; private set; }
        public string SheetCount { get; private set; }
        public string ProductModel { get; private set; }
        public string SourcePath { get; private set; }
        public string SourceFingerprint { get; private set; }
        public IDictionary<string, string> Evidence
        {
            get { return new ReadOnlyDictionary<string, string>(evidence); }
        }
        public string NormalizedDrawingNumber
        {
            get { return SemanticDrawingDiffMaps.NormalizeIdentity(DrawingNumber); }
        }
        public string NormalizedSheet
        {
            get { return SemanticDrawingDiffMaps.NormalizeIdentity(Sheet); }
        }
        public string DrawingKey
        {
            get
            {
                if (!string.IsNullOrEmpty(NormalizedDrawingNumber))
                {
                    return NormalizedDrawingNumber + "|sheet:" + NormalizedSheet;
                }
                return "drawing-id:" + SemanticDrawingDiffMaps.NormalizeIdentity(DrawingId);
            }
        }

        public SemanticDrawingIdentityObservation SetDrawingNumber(string value, string source)
        {
            DrawingNumber = value ?? "";
            AddEvidence("drawing_number", source);
            return this;
        }

        public SemanticDrawingIdentityObservation SetDrawingName(string value, string source)
        {
            DrawingName = value ?? "";
            AddEvidence("drawing_name", source);
            return this;
        }

        public SemanticDrawingIdentityObservation SetRevision(string value, string source)
        {
            Revision = value ?? "";
            AddEvidence("revision", source);
            return this;
        }

        public SemanticDrawingIdentityObservation SetStage(string value, string source)
        {
            Stage = value ?? "";
            AddEvidence("stage", source);
            return this;
        }

        public SemanticDrawingIdentityObservation SetSheet(
            string sheet,
            string sheetCount,
            string source)
        {
            Sheet = sheet ?? "";
            SheetCount = sheetCount ?? "";
            AddEvidence("sheet", source);
            return this;
        }

        public SemanticDrawingIdentityObservation SetProductModel(string value, string source)
        {
            ProductModel = value ?? "";
            AddEvidence("product_model", source);
            return this;
        }

        public SemanticDrawingIdentityObservation SetSource(
            string path,
            string fingerprint)
        {
            SourcePath = path ?? "";
            SourceFingerprint = fingerprint ?? "";
            return this;
        }

        public SemanticDrawingIdentityObservation AddEvidence(string key, string value)
        {
            if (!string.IsNullOrWhiteSpace(key) && !string.IsNullOrWhiteSpace(value))
            {
                evidence[key] = value;
            }
            return this;
        }

        public Dictionary<string, object> ToMap()
        {
            return SemanticDrawingDiffMaps.Map(
                "drawing_id", DrawingId,
                "drawing_number", DrawingNumber,
                "normalized_drawing_number", NormalizedDrawingNumber,
                "drawing_name", DrawingName,
                "revision", Revision,
                "stage", Stage,
                "sheet", Sheet,
                "sheet_count", SheetCount,
                "product_model", ProductModel,
                "drawing_key", DrawingKey,
                "source_path", SourcePath,
                "source_fingerprint", SourceFingerprint,
                "evidence", new Dictionary<string, string>(evidence));
        }

    }

    public sealed class SemanticDrawingElementObservation
    {
        readonly Dictionary<string, string> semanticValues;
        readonly Dictionary<string, double> semanticNumbers;
        readonly Dictionary<string, double> geometryMetrics;
        readonly Dictionary<string, string> styleValues;
        readonly Dictionary<string, List<string>> associations;
        readonly List<string> relationKeys;
        readonly List<string> sourceIds;
        readonly List<string> sourceHandles;

        public SemanticDrawingElementObservation(
            string id,
            string domain,
            string kind,
            string stableKey,
            string matchSignature)
        {
            Id = id ?? "";
            Domain = domain ?? "unknown";
            Kind = kind ?? "unknown";
            StableKey = stableKey ?? "";
            MatchSignature = matchSignature ?? "";
            EvidenceStatus = "computed";
            semanticValues = new Dictionary<string, string>(StringComparer.Ordinal);
            semanticNumbers = new Dictionary<string, double>(StringComparer.Ordinal);
            geometryMetrics = new Dictionary<string, double>(StringComparer.Ordinal);
            styleValues = new Dictionary<string, string>(StringComparer.Ordinal);
            associations = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            relationKeys = new List<string>();
            sourceIds = new List<string>();
            sourceHandles = new List<string>();
        }

        public string Id { get; private set; }
        public string Domain { get; private set; }
        public string Kind { get; private set; }
        public string StableKey { get; private set; }
        public string MatchSignature { get; private set; }
        public string GeometrySignature { get; private set; }
        public string EvidenceStatus { get; private set; }
        public bool HasBounds { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }
        public bool HasAnchor { get; private set; }
        public double AnchorX { get; private set; }
        public double AnchorY { get; private set; }
        public IDictionary<string, string> SemanticValues
        {
            get { return new ReadOnlyDictionary<string, string>(semanticValues); }
        }
        public IDictionary<string, double> SemanticNumbers
        {
            get { return new ReadOnlyDictionary<string, double>(semanticNumbers); }
        }
        public IDictionary<string, double> GeometryMetrics
        {
            get { return new ReadOnlyDictionary<string, double>(geometryMetrics); }
        }
        public IDictionary<string, string> StyleValues
        {
            get { return new ReadOnlyDictionary<string, string>(styleValues); }
        }
        public IDictionary<string, IList<string>> Associations
        {
            get
            {
                return new ReadOnlyDictionary<string, IList<string>>(
                    associations.ToDictionary(
                        pair => pair.Key,
                        pair => (IList<string>)pair.Value.AsReadOnly(),
                        StringComparer.Ordinal));
            }
        }
        public IList<string> RelationKeys { get { return relationKeys.AsReadOnly(); } }
        public IList<string> SourceIds { get { return sourceIds.AsReadOnly(); } }
        public IList<string> SourceHandles { get { return sourceHandles.AsReadOnly(); } }
        internal IDictionary<string, string> SemanticValueMap { get { return semanticValues; } }
        internal IDictionary<string, double> SemanticNumberMap { get { return semanticNumbers; } }
        internal IDictionary<string, double> GeometryMetricMap { get { return geometryMetrics; } }
        internal IDictionary<string, string> StyleValueMap { get { return styleValues; } }
        internal IDictionary<string, List<string>> AssociationMap { get { return associations; } }

        public SemanticDrawingElementObservation SetEvidenceStatus(string value)
        {
            EvidenceStatus = string.IsNullOrEmpty(value) ? "computed" : value;
            return this;
        }

        public SemanticDrawingElementObservation SetGeometrySignature(string value)
        {
            GeometrySignature = value ?? "";
            return this;
        }

        public SemanticDrawingElementObservation SetBounds(
            double minX,
            double minY,
            double maxX,
            double maxY)
        {
            if (!SemanticDrawingDiffMaps.IsFinite(minX)
                || !SemanticDrawingDiffMaps.IsFinite(minY)
                || !SemanticDrawingDiffMaps.IsFinite(maxX)
                || !SemanticDrawingDiffMaps.IsFinite(maxY))
            {
                return this;
            }
            HasBounds = true;
            MinX = Math.Min(minX, maxX);
            MinY = Math.Min(minY, maxY);
            MaxX = Math.Max(minX, maxX);
            MaxY = Math.Max(minY, maxY);
            return SetAnchor((MinX + MaxX) * 0.5, (MinY + MaxY) * 0.5);
        }

        public SemanticDrawingElementObservation SetAnchor(double x, double y)
        {
            if (SemanticDrawingDiffMaps.IsFinite(x) && SemanticDrawingDiffMaps.IsFinite(y))
            {
                HasAnchor = true;
                AnchorX = x;
                AnchorY = y;
            }
            return this;
        }

        public SemanticDrawingElementObservation AddSemanticValue(string key, string value)
        {
            if (!string.IsNullOrWhiteSpace(key)) { semanticValues[key] = value ?? ""; }
            return this;
        }

        public SemanticDrawingElementObservation AddSemanticNumber(string key, double value)
        {
            if (!string.IsNullOrWhiteSpace(key) && SemanticDrawingDiffMaps.IsFinite(value))
            {
                semanticNumbers[key] = value;
            }
            return this;
        }

        public SemanticDrawingElementObservation AddGeometryMetric(string key, double value)
        {
            if (!string.IsNullOrWhiteSpace(key) && SemanticDrawingDiffMaps.IsFinite(value))
            {
                geometryMetrics[key] = value;
            }
            return this;
        }

        public SemanticDrawingElementObservation AddStyleValue(string key, string value)
        {
            if (!string.IsNullOrWhiteSpace(key)) { styleValues[key] = value ?? ""; }
            return this;
        }

        public SemanticDrawingElementObservation AddAssociation(string key, string value)
        {
            if (string.IsNullOrWhiteSpace(key) || string.IsNullOrWhiteSpace(value))
            {
                return this;
            }
            List<string> values;
            if (!associations.TryGetValue(key, out values))
            {
                values = new List<string>();
                associations[key] = values;
            }
            if (!values.Contains(value))
            {
                values.Add(value);
                values.Sort(StringComparer.Ordinal);
            }
            return this;
        }

        public SemanticDrawingElementObservation AddRelationKey(string value)
        {
            if (!string.IsNullOrWhiteSpace(value) && !relationKeys.Contains(value))
            {
                relationKeys.Add(value);
                relationKeys.Sort(StringComparer.Ordinal);
            }
            return this;
        }

        public SemanticDrawingElementObservation AddSourceId(string value)
        {
            if (!string.IsNullOrWhiteSpace(value) && !sourceIds.Contains(value))
            {
                sourceIds.Add(value);
                sourceIds.Sort(StringComparer.Ordinal);
            }
            return this;
        }

        public SemanticDrawingElementObservation AddSourceHandle(string value)
        {
            if (!string.IsNullOrWhiteSpace(value) && !sourceHandles.Contains(value))
            {
                sourceHandles.Add(value);
                sourceHandles.Sort(StringComparer.OrdinalIgnoreCase);
                AddRelationKey("source_handle:" + value.ToUpperInvariant());
            }
            return this;
        }

        public Dictionary<string, object> ToMap()
        {
            var associationMap = new Dictionary<string, object>(StringComparer.Ordinal);
            foreach (KeyValuePair<string, List<string>> pair in associations)
            {
                associationMap[pair.Key] = new List<string>(pair.Value);
            }
            return SemanticDrawingDiffMaps.Map(
                "element_id", Id,
                "domain", Domain,
                "kind", Kind,
                "stable_key", StableKey,
                "match_signature", MatchSignature,
                "geometry_signature", GeometrySignature,
                "evidence_status", EvidenceStatus,
                "bounds", HasBounds ? (object)new[] { MinX, MinY, MaxX, MaxY } : null,
                "anchor", HasAnchor ? (object)new[] { AnchorX, AnchorY } : null,
                "semantic_values", new Dictionary<string, string>(semanticValues),
                "semantic_numbers", new Dictionary<string, double>(semanticNumbers),
                "geometry_metrics", new Dictionary<string, double>(geometryMetrics),
                "style_values", new Dictionary<string, string>(styleValues),
                "associations", associationMap,
                "relation_keys", new List<string>(relationKeys),
                "source_ids", new List<string>(sourceIds),
                "source_handles", new List<string>(sourceHandles));
        }
    }

    public sealed class SemanticDrawingIssueObservation
    {
        readonly List<string> sourceIds;

        public SemanticDrawingIssueObservation(
            string issueKey,
            string issueType,
            string state,
            string severity,
            string message)
        {
            IssueKey = issueKey ?? "";
            IssueType = issueType ?? "review_candidate";
            State = state ?? "open";
            Severity = severity ?? "review";
            Message = message ?? "";
            sourceIds = new List<string>();
        }

        public string IssueKey { get; private set; }
        public string IssueType { get; private set; }
        public string State { get; private set; }
        public string Severity { get; private set; }
        public string Message { get; private set; }
        public IList<string> SourceIds { get { return sourceIds.AsReadOnly(); } }

        public SemanticDrawingIssueObservation AddSourceId(string value)
        {
            if (!string.IsNullOrWhiteSpace(value) && !sourceIds.Contains(value))
            {
                sourceIds.Add(value);
                sourceIds.Sort(StringComparer.Ordinal);
            }
            return this;
        }

        public Dictionary<string, object> ToMap()
        {
            return SemanticDrawingDiffMaps.Map(
                "issue_key", IssueKey,
                "issue_type", IssueType,
                "state", State,
                "severity", Severity,
                "message", Message,
                "source_ids", new List<string>(sourceIds));
        }
    }

    public sealed class SemanticDrawingSnapshotDiagnosticRecord
    {
        public SemanticDrawingSnapshotDiagnosticRecord(
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
            return SemanticDrawingDiffMaps.Map(
                "code", Code,
                "status", Status,
                "source_id", SourceId,
                "message", Message);
        }
    }

    public sealed class SemanticDrawingSnapshotDocument
    {
        readonly List<SemanticDrawingElementObservation> elements;
        readonly List<SemanticDrawingIssueObservation> issues;
        readonly List<SemanticDrawingSnapshotDiagnosticRecord> diagnostics;
        readonly Dictionary<string, int> domainCounts;

        public SemanticDrawingSnapshotDocument(
            string snapshotId,
            SemanticDrawingIdentityObservation identity,
            string sourceStatus)
        {
            SnapshotId = snapshotId ?? "";
            Identity = identity ?? new SemanticDrawingIdentityObservation("");
            SourceStatus = string.IsNullOrEmpty(sourceStatus) ? "computed" : sourceStatus;
            elements = new List<SemanticDrawingElementObservation>();
            issues = new List<SemanticDrawingIssueObservation>();
            diagnostics = new List<SemanticDrawingSnapshotDiagnosticRecord>();
            domainCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        }

        public string SnapshotId { get; private set; }
        public SemanticDrawingIdentityObservation Identity { get; private set; }
        public string SourceStatus { get; private set; }
        public bool Truncated { get; private set; }
        public string Status
        {
            get
            {
                if (Truncated || diagnostics.Any(value => value.Status == "unsupported"))
                {
                    return "unsupported_partial";
                }
                if (SourceStatus == "unsupported_partial") { return "unsupported_partial"; }
                if (SourceStatus == "ambiguous"
                    || diagnostics.Any(value => value.Status == "ambiguous"))
                {
                    return "ambiguous";
                }
                return "computed";
            }
        }
        public IList<SemanticDrawingElementObservation> Elements { get { return elements.AsReadOnly(); } }
        public IList<SemanticDrawingIssueObservation> Issues { get { return issues.AsReadOnly(); } }
        public IList<SemanticDrawingSnapshotDiagnosticRecord> Diagnostics
        {
            get { return diagnostics.AsReadOnly(); }
        }
        public IDictionary<string, int> DomainCounts
        {
            get { return new ReadOnlyDictionary<string, int>(domainCounts); }
        }

        internal SemanticDrawingSnapshotDocument SetSnapshotId(string value)
        {
            SnapshotId = value ?? "";
            return this;
        }

        public bool AddElement(SemanticDrawingElementObservation element, int maximumElementCount)
        {
            if (element == null) { return true; }
            if (elements.Count >= Math.Max(1, maximumElementCount))
            {
                MarkTruncated(
                    "SNAPSHOT_ELEMENT_LIMIT_REACHED",
                    element.Id,
                    "The semantic snapshot element limit was reached; remaining elements were not silently treated as absent.");
                return false;
            }
            elements.Add(element);
            int count;
            domainCounts.TryGetValue(element.Domain, out count);
            domainCounts[element.Domain] = count + 1;
            return true;
        }

        public SemanticDrawingSnapshotDocument AddIssue(SemanticDrawingIssueObservation issue)
        {
            if (issue != null) { issues.Add(issue); }
            return this;
        }

        public SemanticDrawingSnapshotDocument AddDiagnostic(
            SemanticDrawingSnapshotDiagnosticRecord diagnostic)
        {
            if (diagnostic != null) { diagnostics.Add(diagnostic); }
            return this;
        }

        public SemanticDrawingSnapshotDocument MarkTruncated(
            string code,
            string sourceId,
            string message)
        {
            Truncated = true;
            if (!diagnostics.Any(value => value.Code == code && value.SourceId == sourceId))
            {
                diagnostics.Add(new SemanticDrawingSnapshotDiagnosticRecord(
                    code, "unsupported", sourceId, message));
            }
            return this;
        }

        public Dictionary<string, object> ToMap()
        {
            return SemanticDrawingDiffMaps.Map(
                "schema_version", "1",
                "analysis_type", "semantic_drawing_snapshot",
                "analyzer_version", "1",
                "snapshot_id", SnapshotId,
                "status", Status,
                "source_status", SourceStatus,
                "truncated", Truncated,
                "identity", Identity.ToMap(),
                "element_count", elements.Count,
                "domain_counts", new Dictionary<string, int>(domainCounts),
                "elements", elements.OrderBy(value => value.Id, StringComparer.Ordinal)
                    .Select(value => value.ToMap()).ToList(),
                "audit_issues", issues.OrderBy(value => value.IssueKey, StringComparer.Ordinal)
                    .Select(value => value.ToMap()).ToList(),
                "diagnostics", diagnostics.Select(value => value.ToMap()).ToList(),
                "semantic_contract", SemanticDrawingDiffMaps.Map(
                    "purpose", "stable_cross_snapshot_evidence_not_a_drawing_revision_verdict",
                    "identity", "title_and_source_identity_evidence_preserved_without_guessing",
                    "geometry", "translation_invariant_signatures_with_source_ids_and_quality_retained",
                    "missing_elements", "snapshot_truncation_or_unsupported_sources_never_mean_absence"),
                "mutation_status", "read_only_no_entities_modified");
        }

        public string ToMarkdown()
        {
            var builder = new StringBuilder();
            builder.AppendLine("# 语义图纸快照");
            builder.AppendLine();
            builder.AppendLine("- 快照：`" + SnapshotId + "`");
            builder.AppendLine("- 图纸标识：`" + Identity.DrawingKey + "`");
            builder.AppendLine("- 版本 / 阶段：`" + Identity.Revision + "` / `" + Identity.Stage + "`");
            builder.AppendLine("- 状态：`" + Status + "`");
            builder.AppendLine("- 语义元素 / 审计问题："
                + elements.Count.ToString(CultureInfo.InvariantCulture) + " / "
                + issues.Count.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine();
            builder.AppendLine("该文件是跨版本比较的稳定输入，不表示自身就是某次设计变更或审图结论；截断和上游降级均必须随快照传播。");
            return builder.ToString().TrimEnd();
        }
    }

    public sealed class SemanticDrawingAlignmentObservation
    {
        public SemanticDrawingAlignmentObservation(
            double translationX,
            double translationY,
            string source,
            string status,
            int supportCount,
            int inlierCount,
            double maximumResidual)
        {
            TranslationX = translationX;
            TranslationY = translationY;
            Source = source ?? "explicit_translation";
            Status = status ?? "computed";
            SupportCount = supportCount;
            InlierCount = inlierCount;
            MaximumResidual = maximumResidual;
        }

        public double TranslationX { get; private set; }
        public double TranslationY { get; private set; }
        public string Source { get; private set; }
        public string Status { get; private set; }
        public int SupportCount { get; private set; }
        public int InlierCount { get; private set; }
        public double MaximumResidual { get; private set; }

        public double[] Transform(double x, double y)
        {
            return new[] { x + TranslationX, y + TranslationY };
        }

        public double[] TransformBounds(
            double minX,
            double minY,
            double maxX,
            double maxY)
        {
            return new[]
            {
                minX + TranslationX,
                minY + TranslationY,
                maxX + TranslationX,
                maxY + TranslationY
            };
        }

        public Dictionary<string, object> ToMap()
        {
            return SemanticDrawingDiffMaps.Map(
                "transform_kind", "translation_only",
                "translation", new[] { TranslationX, TranslationY },
                "source", Source,
                "status", Status,
                "support_count", SupportCount,
                "inlier_count", InlierCount,
                "maximum_residual", MaximumResidual,
                "semantic_boundary", "global_sheet_translation_not_entity_motion_or_arbitrary_affine_warp");
        }
    }

    public sealed class SemanticDrawingIdentityComparisonRecord
    {
        internal SemanticDrawingIdentityComparisonRecord(
            string status,
            bool comparable,
            double confidence,
            string basis,
            SemanticDrawingIdentityObservation baseline,
            SemanticDrawingIdentityObservation current)
        {
            Status = status ?? "identity_not_established";
            Comparable = comparable;
            Confidence = confidence;
            Basis = basis ?? "";
            BaselineDrawingKey = baseline == null ? "" : baseline.DrawingKey;
            CurrentDrawingKey = current == null ? "" : current.DrawingKey;
            BaselineRevision = baseline == null ? "" : baseline.Revision;
            CurrentRevision = current == null ? "" : current.Revision;
            BaselineStage = baseline == null ? "" : baseline.Stage;
            CurrentStage = current == null ? "" : current.Stage;
        }

        public string Status { get; private set; }
        public bool Comparable { get; private set; }
        public double Confidence { get; private set; }
        public string Basis { get; private set; }
        public string BaselineDrawingKey { get; private set; }
        public string CurrentDrawingKey { get; private set; }
        public string BaselineRevision { get; private set; }
        public string CurrentRevision { get; private set; }
        public string BaselineStage { get; private set; }
        public string CurrentStage { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return SemanticDrawingDiffMaps.Map(
                "status", Status,
                "comparable", Comparable,
                "confidence", Confidence,
                "basis", Basis,
                "baseline_drawing_key", BaselineDrawingKey,
                "current_drawing_key", CurrentDrawingKey,
                "baseline_revision", BaselineRevision,
                "current_revision", CurrentRevision,
                "baseline_stage", BaselineStage,
                "current_stage", CurrentStage);
        }
    }

    public sealed class SemanticPropertyDifferenceRecord
    {
        internal SemanticPropertyDifferenceRecord(
            string category,
            string key,
            object baseline,
            object current,
            string comparisonStatus)
        {
            Category = category ?? "semantic";
            Key = key ?? "";
            BaselineValue = baseline;
            CurrentValue = current;
            ComparisonStatus = comparisonStatus ?? "changed";
        }

        public string Category { get; private set; }
        public string Key { get; private set; }
        public object BaselineValue { get; private set; }
        public object CurrentValue { get; private set; }
        public string ComparisonStatus { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return SemanticDrawingDiffMaps.Map(
                "category", Category,
                "key", Key,
                "baseline", BaselineValue,
                "current", CurrentValue,
                "comparison_status", ComparisonStatus);
        }
    }

    public sealed class SemanticDrawingElementChangeRecord
    {
        readonly List<string> changeKinds;
        readonly List<SemanticPropertyDifferenceRecord> propertyDifferences;
        readonly List<string> relationKeys;
        readonly List<string> baselineSourceIds;
        readonly List<string> currentSourceIds;

        internal SemanticDrawingElementChangeRecord(
            string id,
            string domain,
            string kind,
            SemanticDrawingElementObservation baseline,
            SemanticDrawingElementObservation current,
            string matchMethod,
            double matchScore,
            IEnumerable<string> kinds,
            IEnumerable<SemanticPropertyDifferenceRecord> differences,
            double? localMovement,
            double[] changeBounds)
        {
            Id = id ?? "";
            Domain = domain ?? "";
            Kind = kind ?? "";
            BaselineElementId = baseline == null ? "" : baseline.Id;
            CurrentElementId = current == null ? "" : current.Id;
            BaselineStableKey = baseline == null ? "" : baseline.StableKey;
            CurrentStableKey = current == null ? "" : current.StableKey;
            MatchMethod = matchMethod ?? "unmatched";
            MatchScore = matchScore;
            changeKinds = SemanticDrawingDiffMaps.SortedUnique(kinds);
            propertyDifferences = differences == null
                ? new List<SemanticPropertyDifferenceRecord>()
                : differences.ToList();
            LocalMovement = localMovement;
            ChangeBounds = changeBounds;
            relationKeys = SemanticDrawingDiffMaps.SortedUnique(
                (baseline == null ? Enumerable.Empty<string>() : baseline.RelationKeys)
                .Concat(current == null ? Enumerable.Empty<string>() : current.RelationKeys));
            baselineSourceIds = baseline == null
                ? new List<string>()
                : SemanticDrawingDiffMaps.SortedUnique(baseline.SourceIds);
            currentSourceIds = current == null
                ? new List<string>()
                : SemanticDrawingDiffMaps.SortedUnique(current.SourceIds);
        }

        public string Id { get; private set; }
        public string Domain { get; private set; }
        public string Kind { get; private set; }
        public string BaselineElementId { get; private set; }
        public string CurrentElementId { get; private set; }
        public string BaselineStableKey { get; private set; }
        public string CurrentStableKey { get; private set; }
        public string MatchMethod { get; private set; }
        public double MatchScore { get; private set; }
        public IList<string> ChangeKinds { get { return changeKinds.AsReadOnly(); } }
        public IList<SemanticPropertyDifferenceRecord> PropertyDifferences
        {
            get { return propertyDifferences.AsReadOnly(); }
        }
        public double? LocalMovement { get; private set; }
        public double[] ChangeBounds { get; private set; }
        public IList<string> RelationKeys { get { return relationKeys.AsReadOnly(); } }
        public IList<string> BaselineSourceIds { get { return baselineSourceIds.AsReadOnly(); } }
        public IList<string> CurrentSourceIds { get { return currentSourceIds.AsReadOnly(); } }
        public bool IsUnchanged { get { return changeKinds.Count == 1 && changeKinds[0] == "unchanged"; } }

        public Dictionary<string, object> ToMap()
        {
            return SemanticDrawingDiffMaps.Map(
                "change_id", Id,
                "domain", Domain,
                "kind", Kind,
                "baseline_element_id", string.IsNullOrEmpty(BaselineElementId) ? null : (object)BaselineElementId,
                "current_element_id", string.IsNullOrEmpty(CurrentElementId) ? null : (object)CurrentElementId,
                "baseline_stable_key", BaselineStableKey,
                "current_stable_key", CurrentStableKey,
                "match_method", MatchMethod,
                "match_score", MatchScore,
                "change_kinds", new List<string>(changeKinds),
                "property_differences", propertyDifferences.Select(value => value.ToMap()).ToList(),
                "local_movement_after_global_alignment", SemanticDrawingDiffMaps.Nullable(LocalMovement),
                "change_bounds", ChangeBounds,
                "relation_keys", new List<string>(relationKeys),
                "baseline_source_ids", new List<string>(baselineSourceIds),
                "current_source_ids", new List<string>(currentSourceIds),
                "semantic_boundary", "classified_snapshot_difference_not_design_intent_acceptance_or_defect_proof");
        }
    }

    public sealed class SemanticDrawingAmbiguousMatchRecord
    {
        readonly List<string> candidateIds;
        readonly List<double> candidateScores;

        internal SemanticDrawingAmbiguousMatchRecord(
            SemanticDrawingElementObservation baseline,
            IEnumerable<SemanticDrawingElementObservation> candidates,
            IEnumerable<double> scores,
            string reason)
        {
            BaselineElementId = baseline == null ? "" : baseline.Id;
            Domain = baseline == null ? "" : baseline.Domain;
            Kind = baseline == null ? "" : baseline.Kind;
            candidateIds = candidates == null
                ? new List<string>()
                : candidates.Select(value => value.Id).ToList();
            candidateScores = scores == null ? new List<double>() : scores.ToList();
            Reason = reason ?? "equal_or_near_equal_candidates";
        }

        public string BaselineElementId { get; private set; }
        public string Domain { get; private set; }
        public string Kind { get; private set; }
        public IList<string> CandidateCurrentElementIds { get { return candidateIds.AsReadOnly(); } }
        public IList<double> CandidateScores { get { return candidateScores.AsReadOnly(); } }
        public string Reason { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return SemanticDrawingDiffMaps.Map(
                "baseline_element_id", BaselineElementId,
                "domain", Domain,
                "kind", Kind,
                "candidate_current_element_ids", new List<string>(candidateIds),
                "candidate_scores", new List<double>(candidateScores),
                "reason", Reason,
                "status", "ambiguous_not_matched_arbitrarily");
        }
    }

    public sealed class SemanticDrawingSynchronizationCandidateRecord
    {
        readonly List<string> changeIds;
        readonly List<string> relationKeys;

        internal SemanticDrawingSynchronizationCandidateRecord(
            string id,
            string kind,
            string evidenceGrade,
            IEnumerable<string> changes,
            IEnumerable<string> relations,
            string message)
        {
            Id = id ?? "";
            Kind = kind ?? "";
            EvidenceGrade = evidenceGrade ?? "candidate";
            changeIds = SemanticDrawingDiffMaps.SortedUnique(changes);
            relationKeys = SemanticDrawingDiffMaps.SortedUnique(relations);
            Message = message ?? "";
        }

        public string Id { get; private set; }
        public string Kind { get; private set; }
        public string EvidenceGrade { get; private set; }
        public IList<string> ChangeIds { get { return changeIds.AsReadOnly(); } }
        public IList<string> RelationKeys { get { return relationKeys.AsReadOnly(); } }
        public string Message { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return SemanticDrawingDiffMaps.Map(
                "synchronization_candidate_id", Id,
                "kind", Kind,
                "evidence_grade", EvidenceGrade,
                "change_ids", new List<string>(changeIds),
                "relation_keys", new List<string>(relationKeys),
                "message", Message,
                "semantic_boundary", "cross_domain_review_candidate_not_proof_that_a_dependent_value_should_change");
        }
    }

    public sealed class SemanticDrawingIssueLifecycleRecord
    {
        internal SemanticDrawingIssueLifecycleRecord(
            string issueKey,
            string lifecycle,
            SemanticDrawingIssueObservation baseline,
            SemanticDrawingIssueObservation current)
        {
            IssueKey = issueKey ?? "";
            Lifecycle = lifecycle ?? "unknown";
            BaselineState = baseline == null ? "" : baseline.State;
            CurrentState = current == null ? "" : current.State;
            BaselineMessage = baseline == null ? "" : baseline.Message;
            CurrentMessage = current == null ? "" : current.Message;
        }

        public string IssueKey { get; private set; }
        public string Lifecycle { get; private set; }
        public string BaselineState { get; private set; }
        public string CurrentState { get; private set; }
        public string BaselineMessage { get; private set; }
        public string CurrentMessage { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return SemanticDrawingDiffMaps.Map(
                "issue_key", IssueKey,
                "lifecycle", Lifecycle,
                "baseline_state", BaselineState,
                "current_state", CurrentState,
                "baseline_message", BaselineMessage,
                "current_message", CurrentMessage,
                "semantic_boundary", "issue_key_lifecycle_not_automatic_acceptance_or_closure_approval");
        }
    }

    public sealed class SemanticDrawingDiffRegionRecord
    {
        readonly List<string> changeIds;
        readonly Dictionary<string, int> domainCounts;

        internal SemanticDrawingDiffRegionRecord(
            string id,
            double minX,
            double minY,
            double maxX,
            double maxY,
            IEnumerable<SemanticDrawingElementChangeRecord> changes)
        {
            Id = id ?? "";
            MinX = minX;
            MinY = minY;
            MaxX = maxX;
            MaxY = maxY;
            List<SemanticDrawingElementChangeRecord> values = changes == null
                ? new List<SemanticDrawingElementChangeRecord>()
                : changes.ToList();
            changeIds = SemanticDrawingDiffMaps.SortedUnique(values.Select(value => value.Id));
            domainCounts = values.GroupBy(value => value.Domain, StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.Count(), StringComparer.Ordinal);
        }

        public string Id { get; private set; }
        public double MinX { get; private set; }
        public double MinY { get; private set; }
        public double MaxX { get; private set; }
        public double MaxY { get; private set; }
        public IList<string> ChangeIds { get { return changeIds.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return SemanticDrawingDiffMaps.Map(
                "change_region_id", Id,
                "bounds", new[] { MinX, MinY, MaxX, MaxY },
                "change_count", changeIds.Count,
                "domain_counts", new Dictionary<string, int>(domainCounts),
                "change_ids", new List<string>(changeIds));
        }
    }

    public sealed class SemanticDrawingDiffDiagnosticRecord
    {
        public SemanticDrawingDiffDiagnosticRecord(
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
            return SemanticDrawingDiffMaps.Map(
                "code", Code,
                "status", Status,
                "source_id", SourceId,
                "message", Message);
        }
    }

    public sealed class SemanticDrawingDiffDocument
    {
        readonly List<SemanticDrawingElementChangeRecord> changes;
        readonly List<SemanticDrawingAmbiguousMatchRecord> ambiguousMatches;
        readonly List<SemanticDrawingSynchronizationCandidateRecord> synchronizationCandidates;
        readonly List<SemanticDrawingIssueLifecycleRecord> issueLifecycles;
        readonly List<SemanticDrawingDiffRegionRecord> changeRegions;
        readonly List<SemanticDrawingDiffDiagnosticRecord> diagnostics;
        readonly Dictionary<string, int> changeKindCounts;
        readonly Dictionary<string, int> domainChangeCounts;

        internal SemanticDrawingDiffDocument(
            SemanticDrawingSnapshotDocument baseline,
            SemanticDrawingSnapshotDocument current,
            SemanticDrawingIdentityComparisonRecord identity,
            SemanticDrawingAlignmentObservation alignment,
            IEnumerable<SemanticDrawingElementChangeRecord> changeValues,
            IEnumerable<SemanticDrawingAmbiguousMatchRecord> ambiguousValues,
            IEnumerable<SemanticDrawingSynchronizationCandidateRecord> synchronizationValues,
            IEnumerable<SemanticDrawingIssueLifecycleRecord> lifecycleValues,
            IEnumerable<SemanticDrawingDiffRegionRecord> regionValues,
            IEnumerable<SemanticDrawingDiffDiagnosticRecord> diagnosticValues,
            int candidateComparisonCount,
            bool candidateBudgetTruncated)
        {
            BaselineSnapshotId = baseline == null ? "" : baseline.SnapshotId;
            CurrentSnapshotId = current == null ? "" : current.SnapshotId;
            BaselineSnapshotStatus = baseline == null ? "unsupported_partial" : baseline.Status;
            CurrentSnapshotStatus = current == null ? "unsupported_partial" : current.Status;
            Identity = identity;
            Alignment = alignment;
            changes = changeValues == null
                ? new List<SemanticDrawingElementChangeRecord>()
                : changeValues.OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
            ambiguousMatches = ambiguousValues == null
                ? new List<SemanticDrawingAmbiguousMatchRecord>()
                : ambiguousValues.OrderBy(value => value.BaselineElementId, StringComparer.Ordinal).ToList();
            synchronizationCandidates = synchronizationValues == null
                ? new List<SemanticDrawingSynchronizationCandidateRecord>()
                : synchronizationValues.OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
            issueLifecycles = lifecycleValues == null
                ? new List<SemanticDrawingIssueLifecycleRecord>()
                : lifecycleValues.OrderBy(value => value.IssueKey, StringComparer.Ordinal).ToList();
            changeRegions = regionValues == null
                ? new List<SemanticDrawingDiffRegionRecord>()
                : regionValues.OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
            diagnostics = diagnosticValues == null
                ? new List<SemanticDrawingDiffDiagnosticRecord>()
                : diagnosticValues.ToList();
            CandidateComparisonCount = candidateComparisonCount;
            CandidateBudgetTruncated = candidateBudgetTruncated;
            changeKindCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            domainChangeCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            foreach (SemanticDrawingElementChangeRecord change in changes.Where(value => !value.IsUnchanged))
            {
                foreach (string kind in change.ChangeKinds)
                {
                    int count;
                    changeKindCounts.TryGetValue(kind, out count);
                    changeKindCounts[kind] = count + 1;
                }
                int domainCount;
                domainChangeCounts.TryGetValue(change.Domain, out domainCount);
                domainChangeCounts[change.Domain] = domainCount + 1;
            }
        }

        public string BaselineSnapshotId { get; private set; }
        public string CurrentSnapshotId { get; private set; }
        public string BaselineSnapshotStatus { get; private set; }
        public string CurrentSnapshotStatus { get; private set; }
        public SemanticDrawingIdentityComparisonRecord Identity { get; private set; }
        public SemanticDrawingAlignmentObservation Alignment { get; private set; }
        public int CandidateComparisonCount { get; private set; }
        public bool CandidateBudgetTruncated { get; private set; }
        public IList<SemanticDrawingElementChangeRecord> Changes { get { return changes.AsReadOnly(); } }
        public IList<SemanticDrawingAmbiguousMatchRecord> AmbiguousMatches
        {
            get { return ambiguousMatches.AsReadOnly(); }
        }
        public IList<SemanticDrawingSynchronizationCandidateRecord> SynchronizationCandidates
        {
            get { return synchronizationCandidates.AsReadOnly(); }
        }
        public IList<SemanticDrawingIssueLifecycleRecord> IssueLifecycles
        {
            get { return issueLifecycles.AsReadOnly(); }
        }
        public IList<SemanticDrawingDiffRegionRecord> ChangeRegions
        {
            get { return changeRegions.AsReadOnly(); }
        }
        public IList<SemanticDrawingDiffDiagnosticRecord> Diagnostics
        {
            get { return diagnostics.AsReadOnly(); }
        }
        public int MatchedElementCount
        {
            get { return changes.Count(value => !string.IsNullOrEmpty(value.BaselineElementId) && !string.IsNullOrEmpty(value.CurrentElementId)); }
        }
        public int UnchangedElementCount { get { return changes.Count(value => value.IsUnchanged); } }
        public int ChangedElementCount
        {
            get
            {
                return changes.Count(value => !value.IsUnchanged
                    && !value.ChangeKinds.Contains("added_candidate")
                    && !value.ChangeKinds.Contains("removed_candidate"));
            }
        }
        public int AddedCandidateCount
        {
            get { return changes.Count(value => value.ChangeKinds.Contains("added_candidate")); }
        }
        public int RemovedCandidateCount
        {
            get { return changes.Count(value => value.ChangeKinds.Contains("removed_candidate")); }
        }
        public string Status
        {
            get
            {
                if (Identity == null || !Identity.Comparable) { return "not_comparable"; }
                if (CandidateBudgetTruncated
                    || BaselineSnapshotStatus == "unsupported_partial"
                    || CurrentSnapshotStatus == "unsupported_partial"
                    || diagnostics.Any(value => value.Status == "unsupported"))
                {
                    return "unsupported_partial";
                }
                if ((Alignment != null && Alignment.Status == "ambiguous")
                    || ambiguousMatches.Count > 0
                    || BaselineSnapshotStatus == "ambiguous"
                    || CurrentSnapshotStatus == "ambiguous"
                    || diagnostics.Any(value => value.Status == "ambiguous"))
                {
                    return "ambiguous";
                }
                return "computed";
            }
        }

        public Dictionary<string, object> ToMap()
        {
            return SemanticDrawingDiffMaps.Map(
                "schema_version", "1",
                "analysis_type", "semantic_drawing_diff",
                "analyzer_version", "1",
                "baseline_snapshot_id", BaselineSnapshotId,
                "current_snapshot_id", CurrentSnapshotId,
                "status", Status,
                "baseline_snapshot_status", BaselineSnapshotStatus,
                "current_snapshot_status", CurrentSnapshotStatus,
                "identity_comparison", Identity == null ? null : (object)Identity.ToMap(),
                "alignment", Alignment == null ? null : (object)Alignment.ToMap(),
                "candidate_comparison_count", CandidateComparisonCount,
                "candidate_budget_truncated", CandidateBudgetTruncated,
                "matched_element_count", MatchedElementCount,
                "unchanged_element_count", UnchangedElementCount,
                "changed_element_count", ChangedElementCount,
                "added_candidate_count", AddedCandidateCount,
                "removed_candidate_count", RemovedCandidateCount,
                "ambiguous_match_count", ambiguousMatches.Count,
                "synchronization_candidate_count", synchronizationCandidates.Count,
                "change_region_count", changeRegions.Count,
                "change_kind_counts", new Dictionary<string, int>(changeKindCounts),
                "domain_change_counts", new Dictionary<string, int>(domainChangeCounts),
                "changes", changes.Select(value => value.ToMap()).ToList(),
                "ambiguous_matches", ambiguousMatches.Select(value => value.ToMap()).ToList(),
                "synchronization_candidates", synchronizationCandidates.Select(value => value.ToMap()).ToList(),
                "issue_lifecycles", issueLifecycles.Select(value => value.ToMap()).ToList(),
                "change_regions", changeRegions.Select(value => value.ToMap()).ToList(),
                "diagnostics", diagnostics.Select(value => value.ToMap()).ToList(),
                "semantic_contract", SemanticDrawingDiffMaps.Map(
                    "identity_gate", "unrelated_or_unverified_drawings_are_not_mass_classified_as_added_or_removed",
                    "alignment", "translation_only_global_alignment_no_arbitrary_affine_warp",
                    "matching", "stable_key_then_structure_and_spatial_fallback_with_ties_preserved",
                    "change", "geometry_semantic_style_association_and_motion_are_separate_evidence_classes",
                    "unmatched", "added_removed_are_candidates_only_after_comparable_identity_and_complete_matching",
                    "synchronization", "cross_domain_staleness_candidate_not_business_rule_or_defect_proof",
                    "issue_lifecycle", "issue_key_continuity_not_automatic_acceptance_or_closure_approval"),
                "mutation_status", "read_only_no_entities_modified");
        }

        public string ToMarkdown()
        {
            var builder = new StringBuilder();
            builder.AppendLine("# 版本与阶段语义差分");
            builder.AppendLine();
            builder.AppendLine("- 基线 / 当前：`" + BaselineSnapshotId + "` / `" + CurrentSnapshotId + "`");
            builder.AppendLine("- 身份：`" + (Identity == null ? "not_available" : Identity.Status) + "`");
            builder.AppendLine("- 状态：`" + Status + "`");
            builder.AppendLine("- 匹配 / 未变 / 已变："
                + MatchedElementCount.ToString(CultureInfo.InvariantCulture) + " / "
                + UnchangedElementCount.ToString(CultureInfo.InvariantCulture) + " / "
                + ChangedElementCount.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine("- 新增候选 / 删除候选 / 多解："
                + AddedCandidateCount.ToString(CultureInfo.InvariantCulture) + " / "
                + RemovedCandidateCount.ToString(CultureInfo.InvariantCulture) + " / "
                + ambiguousMatches.Count.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine("- 同步复核候选 / 差异区域："
                + synchronizationCandidates.Count.ToString(CultureInfo.InvariantCulture) + " / "
                + changeRegions.Count.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine();
            builder.AppendLine("差分是证据分类，不自动证明设计意图、修改正确性、漏改或规范不合格；图纸身份、多解、预算和上游降级均会阻止过度结论。");
            return builder.ToString().TrimEnd();
        }
    }

    public static class SemanticDrawingDiffAnalyzer
    {
        sealed class ElementPair
        {
            public SemanticDrawingElementObservation Baseline;
            public SemanticDrawingElementObservation Current;
            public string Method;
            public double Score;
        }

        sealed class CandidateLink
        {
            public SemanticDrawingElementObservation Baseline;
            public SemanticDrawingElementObservation Current;
            public double Score;
        }

        sealed class RegionCluster
        {
            public double MinX;
            public double MinY;
            public double MaxX;
            public double MaxY;
            public readonly List<SemanticDrawingElementChangeRecord> Changes =
                new List<SemanticDrawingElementChangeRecord>();
        }

        public static SemanticDrawingDiffDocument Analyze(
            SemanticDrawingSnapshotDocument baseline,
            SemanticDrawingSnapshotDocument current)
        {
            return Analyze(baseline, current, null, new SemanticDrawingDiffConfig());
        }

        public static SemanticDrawingDiffDocument Analyze(
            SemanticDrawingSnapshotDocument baseline,
            SemanticDrawingSnapshotDocument current,
            SemanticDrawingDiffConfig config)
        {
            return Analyze(baseline, current, null, config);
        }

        public static SemanticDrawingDiffDocument Analyze(
            SemanticDrawingSnapshotDocument baseline,
            SemanticDrawingSnapshotDocument current,
            SemanticDrawingAlignmentObservation explicitAlignment,
            SemanticDrawingDiffConfig config)
        {
            if (baseline == null) { throw new ArgumentNullException("baseline"); }
            if (current == null) { throw new ArgumentNullException("current"); }
            config = config ?? new SemanticDrawingDiffConfig();
            var diagnostics = new List<SemanticDrawingDiffDiagnosticRecord>();
            SemanticDrawingIdentityComparisonRecord identity = CompareIdentity(
                baseline.Identity, current.Identity, config);
            if (!identity.Comparable && config.RequireComparableDrawingIdentity)
            {
                diagnostics.Add(new SemanticDrawingDiffDiagnosticRecord(
                    "DRAWING_IDENTITY_NOT_COMPARABLE",
                    "unsupported",
                    baseline.SnapshotId + "|" + current.SnapshotId,
                    "The two snapshots were not mass-classified as additions or removals because drawing identity was not established."));
                return new SemanticDrawingDiffDocument(
                    baseline,
                    current,
                    identity,
                    explicitAlignment ?? new SemanticDrawingAlignmentObservation(
                        0, 0, "not_computed_identity_gate", "unsupported", 0, 0, 0),
                    null, null, null, null, null, diagnostics, 0, false);
            }
            int maximumInput = Math.Max(1, config.MaximumInputElementCountPerSnapshot);
            if (baseline.Elements.Count > maximumInput || current.Elements.Count > maximumInput)
            {
                diagnostics.Add(new SemanticDrawingDiffDiagnosticRecord(
                    "DIFF_INPUT_ELEMENT_LIMIT_REACHED",
                    "unsupported",
                    baseline.SnapshotId + "|" + current.SnapshotId,
                    "At least one semantic snapshot exceeds the configured input element limit; unmatched elements were not classified as additions or removals."));
                return new SemanticDrawingDiffDocument(
                    baseline,
                    current,
                    identity,
                    explicitAlignment ?? new SemanticDrawingAlignmentObservation(
                        0, 0, "not_computed_input_limit", "unsupported", 0, 0, 0),
                    null, null, null, null, null, diagnostics, 0, true);
            }

            double drawingSpan = DrawingSpan(baseline.Elements.Concat(current.Elements));
            SemanticDrawingAlignmentObservation alignment = explicitAlignment
                ?? InferAlignment(baseline, current, drawingSpan, config, diagnostics);
            var pairs = new List<ElementPair>();
            var matchedBaseline = new HashSet<string>(StringComparer.Ordinal);
            var matchedCurrent = new HashSet<string>(StringComparer.Ordinal);
            var ambiguousBaseline = new HashSet<string>(StringComparer.Ordinal);
            var ambiguousCurrent = new HashSet<string>(StringComparer.Ordinal);
            var ambiguousMatches = new List<SemanticDrawingAmbiguousMatchRecord>();

            MatchStableKeys(
                baseline.Elements,
                current.Elements,
                pairs,
                matchedBaseline,
                matchedCurrent);
            int candidateComparisons = 0;
            bool candidateBudgetTruncated = false;
            MatchFallback(
                baseline.Elements.Where(value => !matchedBaseline.Contains(value.Id)).ToList(),
                current.Elements.Where(value => !matchedCurrent.Contains(value.Id)).ToList(),
                alignment,
                drawingSpan,
                config,
                pairs,
                matchedBaseline,
                matchedCurrent,
                ambiguousBaseline,
                ambiguousCurrent,
                ambiguousMatches,
                ref candidateComparisons,
                ref candidateBudgetTruncated);
            if (candidateBudgetTruncated)
            {
                diagnostics.Add(new SemanticDrawingDiffDiagnosticRecord(
                    "MATCH_CANDIDATE_LIMIT_REACHED",
                    "unsupported",
                    baseline.SnapshotId + "|" + current.SnapshotId,
                    "Fallback candidate enumeration was truncated; remaining unmatched elements were not classified as additions or removals."));
            }

            var changes = new List<SemanticDrawingElementChangeRecord>();
            foreach (ElementPair pair in pairs)
            {
                changes.Add(CompareElements(pair, alignment, drawingSpan, config));
            }
            bool alignmentSupportsUnmatchedClassification = alignment != null
                && alignment.Status == "computed";
            if (!candidateBudgetTruncated && alignmentSupportsUnmatchedClassification)
            {
                foreach (SemanticDrawingElementObservation element in baseline.Elements
                    .Where(value => !matchedBaseline.Contains(value.Id)
                        && !ambiguousBaseline.Contains(value.Id)))
                {
                    changes.Add(CreateUnmatchedChange(element, null, "removed_candidate", alignment));
                }
                foreach (SemanticDrawingElementObservation element in current.Elements
                    .Where(value => !matchedCurrent.Contains(value.Id)
                        && !ambiguousCurrent.Contains(value.Id)))
                {
                    changes.Add(CreateUnmatchedChange(null, element, "added_candidate", alignment));
                }
            }
            else if (!candidateBudgetTruncated)
            {
                diagnostics.Add(new SemanticDrawingDiffDiagnosticRecord(
                    "UNMATCHED_CLASSIFICATION_SUPPRESSED_BY_ALIGNMENT",
                    "ambiguous",
                    baseline.SnapshotId + "|" + current.SnapshotId,
                    "Global alignment was not independently established; unmatched elements were not classified as additions or removals."));
            }

            List<SemanticDrawingSynchronizationCandidateRecord> synchronization =
                BuildSynchronizationCandidates(changes, config, diagnostics);
            List<SemanticDrawingIssueLifecycleRecord> lifecycles = BuildIssueLifecycles(
                baseline.Issues, current.Issues, diagnostics);
            List<SemanticDrawingDiffRegionRecord> regions = BuildChangeRegions(
                changes, drawingSpan, config, diagnostics);
            return new SemanticDrawingDiffDocument(
                baseline,
                current,
                identity,
                alignment,
                changes,
                ambiguousMatches,
                synchronization,
                lifecycles,
                regions,
                diagnostics,
                candidateComparisons,
                candidateBudgetTruncated);
        }

        static SemanticDrawingIdentityComparisonRecord CompareIdentity(
            SemanticDrawingIdentityObservation baseline,
            SemanticDrawingIdentityObservation current,
            SemanticDrawingDiffConfig config)
        {
            baseline = baseline ?? new SemanticDrawingIdentityObservation("");
            current = current ?? new SemanticDrawingIdentityObservation("");
            string leftNumber = baseline.NormalizedDrawingNumber;
            string rightNumber = current.NormalizedDrawingNumber;
            if (!string.IsNullOrEmpty(leftNumber) && !string.IsNullOrEmpty(rightNumber))
            {
                if (!string.Equals(leftNumber, rightNumber, StringComparison.Ordinal))
                {
                    return new SemanticDrawingIdentityComparisonRecord(
                        "different_drawing_number_proven", false, 1.0,
                        "conflicting_authored_drawing_number", baseline, current);
                }
                string leftSheet = baseline.NormalizedSheet;
                string rightSheet = current.NormalizedSheet;
                if (!string.IsNullOrEmpty(leftSheet) && !string.IsNullOrEmpty(rightSheet)
                    && !string.Equals(leftSheet, rightSheet, StringComparison.Ordinal))
                {
                    return new SemanticDrawingIdentityComparisonRecord(
                        "different_sheet_proven", false, 1.0,
                        "same_drawing_number_conflicting_authored_sheet", baseline, current);
                }
                return new SemanticDrawingIdentityComparisonRecord(
                    "same_drawing_supported", true, 1.0,
                    string.IsNullOrEmpty(leftSheet) || string.IsNullOrEmpty(rightSheet)
                        ? "same_authored_drawing_number_sheet_incomplete"
                        : "same_authored_drawing_number_and_sheet",
                    baseline, current);
            }
            string leftId = SemanticDrawingDiffMaps.NormalizeIdentity(baseline.DrawingId);
            string rightId = SemanticDrawingDiffMaps.NormalizeIdentity(current.DrawingId);
            if (!string.IsNullOrEmpty(leftId) && string.Equals(leftId, rightId, StringComparison.Ordinal))
            {
                return new SemanticDrawingIdentityComparisonRecord(
                    "same_drawing_candidate", true, 0.75,
                    "same_extraction_drawing_id_without_authored_number", baseline, current);
            }
            if (config.AllowUnverifiedIdentity)
            {
                return new SemanticDrawingIdentityComparisonRecord(
                    "identity_unverified_comparison_explicitly_allowed", true, 0.25,
                    "caller_override", baseline, current);
            }
            return new SemanticDrawingIdentityComparisonRecord(
                "identity_not_established", false, 0,
                "no_matching_authored_number_or_drawing_id", baseline, current);
        }

        static SemanticDrawingAlignmentObservation InferAlignment(
            SemanticDrawingSnapshotDocument baseline,
            SemanticDrawingSnapshotDocument current,
            double drawingSpan,
            SemanticDrawingDiffConfig config,
            IList<SemanticDrawingDiffDiagnosticRecord> diagnostics)
        {
            Dictionary<string, SemanticDrawingElementObservation> left = UniqueStableKeys(
                baseline.Elements.Where(value => value.HasAnchor));
            Dictionary<string, SemanticDrawingElementObservation> right = UniqueStableKeys(
                current.Elements.Where(value => value.HasAnchor));
            var deltas = new List<double[]>();
            foreach (KeyValuePair<string, SemanticDrawingElementObservation> pair in left)
            {
                SemanticDrawingElementObservation other;
                if (!right.TryGetValue(pair.Key, out other)
                    || pair.Value.Domain != other.Domain
                    || pair.Value.Kind != other.Kind
                    || (!string.IsNullOrEmpty(pair.Value.GeometrySignature)
                        && !string.IsNullOrEmpty(other.GeometrySignature)
                        && pair.Value.GeometrySignature != other.GeometrySignature))
                {
                    continue;
                }
                deltas.Add(new[]
                {
                    other.AnchorX - pair.Value.AnchorX,
                    other.AnchorY - pair.Value.AnchorY
                });
            }
            int minimum = Math.Max(1, config.MinimumAlignmentSupport);
            if (deltas.Count < minimum)
            {
                diagnostics.Add(new SemanticDrawingDiffDiagnosticRecord(
                    "ALIGNMENT_SUPPORT_INSUFFICIENT",
                    "ambiguous",
                    baseline.SnapshotId + "|" + current.SnapshotId,
                    "Global translation could not be independently inferred from enough stable unchanged anchors; identity coordinates are retained as a candidate alignment."));
                return new SemanticDrawingAlignmentObservation(
                    0, 0, "identity_coordinates_insufficient_support", "ambiguous",
                    deltas.Count, deltas.Count, 0);
            }
            double medianX = Median(deltas.Select(value => value[0]));
            double medianY = Median(deltas.Select(value => value[1]));
            double tolerance = Math.Max(
                Math.Max(0, config.AbsoluteCoordinateTolerance),
                Math.Max(0, drawingSpan) * Math.Max(0, config.AlignmentToleranceRatio));
            List<double[]> inliers = deltas.Where(value => Distance(
                value[0], value[1], medianX, medianY) <= tolerance).ToList();
            double ratio = deltas.Count == 0 ? 0 : (double)inliers.Count / deltas.Count;
            if (inliers.Count < minimum || ratio < Math.Max(0, config.MinimumAlignmentInlierRatio))
            {
                diagnostics.Add(new SemanticDrawingDiffDiagnosticRecord(
                    "ALIGNMENT_TRANSLATION_AMBIGUOUS",
                    "ambiguous",
                    baseline.SnapshotId + "|" + current.SnapshotId,
                    "Stable anchors do not support one dominant sheet translation; identity coordinates are retained and element motion remains review evidence."));
                return new SemanticDrawingAlignmentObservation(
                    0, 0, "identity_coordinates_conflicting_translation_candidates", "ambiguous",
                    deltas.Count, inliers.Count,
                    deltas.Max(value => Distance(value[0], value[1], medianX, medianY)));
            }
            double dx = Median(inliers.Select(value => value[0]));
            double dy = Median(inliers.Select(value => value[1]));
            double maximumResidual = inliers.Count == 0
                ? 0
                : inliers.Max(value => Distance(value[0], value[1], dx, dy));
            return new SemanticDrawingAlignmentObservation(
                dx,
                dy,
                Math.Abs(dx) <= tolerance && Math.Abs(dy) <= tolerance
                    ? "stable_anchor_identity_alignment"
                    : "stable_anchor_inferred_translation",
                "computed",
                deltas.Count,
                inliers.Count,
                maximumResidual);
        }

        static void MatchStableKeys(
            IList<SemanticDrawingElementObservation> baseline,
            IList<SemanticDrawingElementObservation> current,
            IList<ElementPair> pairs,
            ISet<string> matchedBaseline,
            ISet<string> matchedCurrent)
        {
            Dictionary<string, SemanticDrawingElementObservation> left = UniqueStableKeys(baseline);
            Dictionary<string, SemanticDrawingElementObservation> right = UniqueStableKeys(current);
            foreach (KeyValuePair<string, SemanticDrawingElementObservation> pair in left
                .OrderBy(value => value.Key, StringComparer.Ordinal))
            {
                SemanticDrawingElementObservation other;
                if (!right.TryGetValue(pair.Key, out other)) { continue; }
                if (pair.Value.Domain != other.Domain) { continue; }
                pairs.Add(new ElementPair
                {
                    Baseline = pair.Value,
                    Current = other,
                    Method = "stable_key_exact",
                    Score = 0
                });
                matchedBaseline.Add(pair.Value.Id);
                matchedCurrent.Add(other.Id);
            }
        }

        static Dictionary<string, SemanticDrawingElementObservation> UniqueStableKeys(
            IEnumerable<SemanticDrawingElementObservation> elements)
        {
            return elements.Where(value => !string.IsNullOrEmpty(value.StableKey))
                .GroupBy(value => value.Domain + "\u001f" + value.StableKey, StringComparer.Ordinal)
                .Where(group => group.Count() == 1)
                .ToDictionary(group => group.Key, group => group.First(), StringComparer.Ordinal);
        }

        static void MatchFallback(
            IList<SemanticDrawingElementObservation> baseline,
            IList<SemanticDrawingElementObservation> current,
            SemanticDrawingAlignmentObservation alignment,
            double drawingSpan,
            SemanticDrawingDiffConfig config,
            IList<ElementPair> pairs,
            ISet<string> matchedBaseline,
            ISet<string> matchedCurrent,
            ISet<string> ambiguousBaseline,
            ISet<string> ambiguousCurrent,
            IList<SemanticDrawingAmbiguousMatchRecord> ambiguousMatches,
            ref int candidateComparisons,
            ref bool candidateBudgetTruncated)
        {
            double tolerance = Math.Max(
                Math.Max(0.000000001, config.MinimumFallbackSpatialTolerance),
                Math.Max(0, drawingSpan) * Math.Max(0, config.FallbackSpatialToleranceRatio));
            var currentGroups = current.Where(value => !string.IsNullOrEmpty(value.MatchSignature))
                .GroupBy(GroupKey, StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.ToList(), StringComparer.Ordinal);
            foreach (IGrouping<string, SemanticDrawingElementObservation> leftGroup in baseline
                .Where(value => !string.IsNullOrEmpty(value.MatchSignature))
                .GroupBy(GroupKey, StringComparer.Ordinal)
                .OrderBy(group => group.Key, StringComparer.Ordinal))
            {
                List<SemanticDrawingElementObservation> rightGroup;
                if (!currentGroups.TryGetValue(leftGroup.Key, out rightGroup)) { continue; }
                List<SemanticDrawingElementObservation> leftValues = leftGroup.ToList();
                if (leftValues.Count == 1 && rightGroup.Count == 1
                    && (!leftValues[0].HasAnchor || !rightGroup[0].HasAnchor))
                {
                    pairs.Add(new ElementPair
                    {
                        Baseline = leftValues[0],
                        Current = rightGroup[0],
                        Method = "unique_structure_signature",
                        Score = 0.25
                    });
                    matchedBaseline.Add(leftValues[0].Id);
                    matchedCurrent.Add(rightGroup[0].Id);
                    continue;
                }
                var linksByBaseline = new Dictionary<string, List<CandidateLink>>(StringComparer.Ordinal);
                var rightSpatialIndex = new Dictionary<string, List<SemanticDrawingElementObservation>>(
                    StringComparer.Ordinal);
                foreach (SemanticDrawingElementObservation rightElement in rightGroup.Where(value => value.HasAnchor))
                {
                    string cell = SpatialCellKey(rightElement.AnchorX, rightElement.AnchorY, tolerance);
                    List<SemanticDrawingElementObservation> bucket;
                    if (!rightSpatialIndex.TryGetValue(cell, out bucket))
                    {
                        bucket = new List<SemanticDrawingElementObservation>();
                        rightSpatialIndex[cell] = bucket;
                    }
                    bucket.Add(rightElement);
                }
                foreach (SemanticDrawingElementObservation leftElement in leftValues.Where(value => value.HasAnchor))
                {
                    double[] transformed = alignment.Transform(leftElement.AnchorX, leftElement.AnchorY);
                    long cellX = SpatialCellCoordinate(transformed[0], tolerance);
                    long cellY = SpatialCellCoordinate(transformed[1], tolerance);
                    for (long offsetX = -1; offsetX <= 1; offsetX++)
                    {
                        for (long offsetY = -1; offsetY <= 1; offsetY++)
                        {
                            List<SemanticDrawingElementObservation> bucket;
                            if (!rightSpatialIndex.TryGetValue(
                                SpatialCellKey(
                                    OffsetCell(cellX, offsetX),
                                    OffsetCell(cellY, offsetY)),
                                out bucket))
                            {
                                continue;
                            }
                            foreach (SemanticDrawingElementObservation rightElement in bucket)
                            {
                                candidateComparisons++;
                                if (candidateComparisons > Math.Max(1, config.MaximumCandidateComparisonCount))
                                {
                                    candidateBudgetTruncated = true;
                                    return;
                                }
                                double distance = Distance(
                                    transformed[0], transformed[1],
                                    rightElement.AnchorX, rightElement.AnchorY);
                                if (distance > tolerance) { continue; }
                                List<CandidateLink> links;
                                if (!linksByBaseline.TryGetValue(leftElement.Id, out links))
                                {
                                    links = new List<CandidateLink>();
                                    linksByBaseline[leftElement.Id] = links;
                                }
                                links.Add(new CandidateLink
                                {
                                    Baseline = leftElement,
                                    Current = rightElement,
                                    Score = distance / tolerance
                                });
                            }
                        }
                    }
                }

                var proposed = new List<CandidateLink>();
                foreach (KeyValuePair<string, List<CandidateLink>> entry in linksByBaseline)
                {
                    List<CandidateLink> ordered = entry.Value
                        .OrderBy(value => value.Score)
                        .ThenBy(value => value.Current.Id, StringComparer.Ordinal)
                        .ToList();
                    if (ordered.Count > 1
                        && Math.Abs(ordered[1].Score - ordered[0].Score)
                            <= Math.Max(0.000000001, config.MatchTieToleranceRatio))
                    {
                        SemanticDrawingElementObservation leftElement = ordered[0].Baseline;
                        List<CandidateLink> tied = ordered.Where(value =>
                            Math.Abs(value.Score - ordered[0].Score)
                                <= Math.Max(0.000000001, config.MatchTieToleranceRatio)).ToList();
                        ambiguousBaseline.Add(leftElement.Id);
                        foreach (CandidateLink link in tied)
                        {
                            ambiguousCurrent.Add(link.Current.Id);
                        }
                        ambiguousMatches.Add(new SemanticDrawingAmbiguousMatchRecord(
                            leftElement,
                            tied.Select(value => value.Current),
                            tied.Select(value => value.Score),
                            "equal_or_near_equal_spatial_candidates"));
                    }
                    else if (ordered.Count > 0)
                    {
                        proposed.Add(ordered[0]);
                    }
                }

                foreach (IGrouping<string, CandidateLink> currentGroup in proposed
                    .GroupBy(value => value.Current.Id, StringComparer.Ordinal))
                {
                    List<CandidateLink> ordered = currentGroup.OrderBy(value => value.Score)
                        .ThenBy(value => value.Baseline.Id, StringComparer.Ordinal).ToList();
                    if (ordered.Count > 1
                        && Math.Abs(ordered[1].Score - ordered[0].Score)
                            <= Math.Max(0.000000001, config.MatchTieToleranceRatio))
                    {
                        List<CandidateLink> tied = ordered.Where(value =>
                            Math.Abs(value.Score - ordered[0].Score)
                                <= Math.Max(0.000000001, config.MatchTieToleranceRatio)).ToList();
                        foreach (CandidateLink link in tied)
                        {
                            ambiguousBaseline.Add(link.Baseline.Id);
                            ambiguousCurrent.Add(link.Current.Id);
                            ambiguousMatches.Add(new SemanticDrawingAmbiguousMatchRecord(
                                link.Baseline,
                                new[] { link.Current },
                                new[] { link.Score },
                                "multiple_baseline_elements_compete_for_same_current_element"));
                        }
                        continue;
                    }
                    CandidateLink selected = ordered[0];
                    if (ambiguousBaseline.Contains(selected.Baseline.Id)
                        || ambiguousCurrent.Contains(selected.Current.Id))
                    {
                        continue;
                    }
                    pairs.Add(new ElementPair
                    {
                        Baseline = selected.Baseline,
                        Current = selected.Current,
                        Method = "structure_signature_spatial_fallback",
                        Score = selected.Score
                    });
                    matchedBaseline.Add(selected.Baseline.Id);
                    matchedCurrent.Add(selected.Current.Id);
                }

                if (leftValues.All(value => !value.HasAnchor)
                    && (leftValues.Count > 1 || rightGroup.Count > 1))
                {
                    foreach (SemanticDrawingElementObservation leftElement in leftValues)
                    {
                        ambiguousBaseline.Add(leftElement.Id);
                        foreach (SemanticDrawingElementObservation rightElement in rightGroup)
                        {
                            ambiguousCurrent.Add(rightElement.Id);
                        }
                        ambiguousMatches.Add(new SemanticDrawingAmbiguousMatchRecord(
                            leftElement, rightGroup, Enumerable.Repeat(0.5, rightGroup.Count),
                            "non_spatial_duplicate_structure_signature"));
                    }
                }
            }
        }

        static string GroupKey(SemanticDrawingElementObservation value)
        {
            return value.Domain + "\u001f" + value.Kind + "\u001f" + value.MatchSignature;
        }

        static long SpatialCellCoordinate(double value, double cellSize)
        {
            double scaled = Math.Floor(value / Math.Max(0.000000001, cellSize));
            if (scaled <= long.MinValue) { return long.MinValue; }
            if (scaled >= long.MaxValue) { return long.MaxValue; }
            return (long)scaled;
        }

        static string SpatialCellKey(double x, double y, double cellSize)
        {
            return SpatialCellKey(
                SpatialCellCoordinate(x, cellSize),
                SpatialCellCoordinate(y, cellSize));
        }

        static string SpatialCellKey(long x, long y)
        {
            return x.ToString(CultureInfo.InvariantCulture) + ","
                + y.ToString(CultureInfo.InvariantCulture);
        }

        static long OffsetCell(long value, long offset)
        {
            if (offset > 0 && value > long.MaxValue - offset) { return long.MaxValue; }
            if (offset < 0 && value < long.MinValue - offset) { return long.MinValue; }
            return value + offset;
        }

        static SemanticDrawingElementChangeRecord CompareElements(
            ElementPair pair,
            SemanticDrawingAlignmentObservation alignment,
            double drawingSpan,
            SemanticDrawingDiffConfig config)
        {
            SemanticDrawingElementObservation baseline = pair.Baseline;
            SemanticDrawingElementObservation current = pair.Current;
            var differences = new List<SemanticPropertyDifferenceRecord>();
            bool semanticChanged = false;
            bool geometryChanged = false;
            bool styleChanged = false;
            bool associationChanged = false;
            bool evidenceChanged = false;
            if (baseline.Kind != current.Kind)
            {
                semanticChanged = true;
                differences.Add(new SemanticPropertyDifferenceRecord(
                    "classification", "kind", baseline.Kind, current.Kind, "changed"));
            }
            semanticChanged |= CompareStringMaps(
                "semantic", baseline.SemanticValueMap, current.SemanticValueMap, differences);
            semanticChanged |= CompareNumberMaps(
                "semantic_numeric", baseline.SemanticNumberMap, current.SemanticNumberMap,
                config, differences);
            geometryChanged |= CompareNumberMaps(
                "geometry", baseline.GeometryMetricMap, current.GeometryMetricMap,
                config, differences);
            if (!string.Equals(
                baseline.GeometrySignature ?? "",
                current.GeometrySignature ?? "",
                StringComparison.Ordinal))
            {
                geometryChanged = true;
                differences.Add(new SemanticPropertyDifferenceRecord(
                    "geometry", "geometry_signature",
                    baseline.GeometrySignature, current.GeometrySignature, "changed"));
            }
            styleChanged |= CompareStringMaps(
                "style", baseline.StyleValueMap, current.StyleValueMap, differences);
            associationChanged |= CompareAssociationMaps(
                baseline.AssociationMap, current.AssociationMap, differences);
            if (!string.Equals(
                baseline.EvidenceStatus ?? "",
                current.EvidenceStatus ?? "",
                StringComparison.Ordinal))
            {
                evidenceChanged = true;
                differences.Add(new SemanticPropertyDifferenceRecord(
                    "evidence", "evidence_status",
                    baseline.EvidenceStatus, current.EvidenceStatus, "changed"));
            }

            double coordinateTolerance = Math.Max(
                Math.Max(0, config.AbsoluteCoordinateTolerance),
                Math.Max(0, drawingSpan) * Math.Max(0, config.RelativeCoordinateTolerance));
            double? movement = null;
            bool moved = false;
            if (baseline.HasAnchor && current.HasAnchor)
            {
                double[] transformed = alignment.Transform(baseline.AnchorX, baseline.AnchorY);
                movement = Distance(
                    transformed[0], transformed[1], current.AnchorX, current.AnchorY);
                moved = movement.Value > coordinateTolerance;
                if (moved)
                {
                    differences.Add(new SemanticPropertyDifferenceRecord(
                        "position", "anchor_after_global_alignment",
                        transformed, new[] { current.AnchorX, current.AnchorY }, "moved"));
                }
            }

            var kinds = new List<string>();
            if (geometryChanged) { kinds.Add("geometry_changed"); }
            if (moved) { kinds.Add("moved"); }
            if (semanticChanged) { kinds.Add("semantic_value_changed"); }
            if (associationChanged) { kinds.Add("association_changed"); }
            if (evidenceChanged) { kinds.Add("evidence_status_changed"); }
            if (styleChanged)
            {
                kinds.Add(geometryChanged || moved || semanticChanged || associationChanged
                    ? "style_changed"
                    : "style_only_changed");
            }
            if (kinds.Count == 0) { kinds.Add("unchanged"); }
            double[] bounds = UnionChangeBounds(baseline, current, alignment);
            return new SemanticDrawingElementChangeRecord(
                "semantic-change:" + SemanticDrawingDiffMaps.Hash(new[]
                {
                    baseline.Id,
                    current.Id,
                    string.Join("|", kinds)
                }),
                current.Domain,
                current.Kind,
                baseline,
                current,
                pair.Method,
                pair.Score,
                kinds,
                differences,
                movement,
                bounds);
        }

        static SemanticDrawingElementChangeRecord CreateUnmatchedChange(
            SemanticDrawingElementObservation baseline,
            SemanticDrawingElementObservation current,
            string kind,
            SemanticDrawingAlignmentObservation alignment)
        {
            SemanticDrawingElementObservation source = current ?? baseline;
            return new SemanticDrawingElementChangeRecord(
                "semantic-change:" + SemanticDrawingDiffMaps.Hash(new[]
                {
                    baseline == null ? "" : baseline.Id,
                    current == null ? "" : current.Id,
                    kind
                }),
                source == null ? "" : source.Domain,
                source == null ? "" : source.Kind,
                baseline,
                current,
                "unmatched_after_complete_matching",
                1,
                new[] { kind },
                null,
                null,
                UnionChangeBounds(baseline, current, alignment));
        }

        static bool CompareStringMaps(
            string category,
            IDictionary<string, string> baseline,
            IDictionary<string, string> current,
            IList<SemanticPropertyDifferenceRecord> differences)
        {
            bool changed = false;
            foreach (string key in baseline.Keys.Concat(current.Keys)
                .Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal))
            {
                string left;
                string right;
                bool hasLeft = baseline.TryGetValue(key, out left);
                bool hasRight = current.TryGetValue(key, out right);
                if (hasLeft == hasRight && string.Equals(left, right, StringComparison.Ordinal))
                {
                    continue;
                }
                changed = true;
                differences.Add(new SemanticPropertyDifferenceRecord(
                    category, key,
                    hasLeft ? (object)left : null,
                    hasRight ? (object)right : null,
                    hasLeft && hasRight ? "changed" : hasLeft ? "removed" : "added"));
            }
            return changed;
        }

        static bool CompareNumberMaps(
            string category,
            IDictionary<string, double> baseline,
            IDictionary<string, double> current,
            SemanticDrawingDiffConfig config,
            IList<SemanticPropertyDifferenceRecord> differences)
        {
            bool changed = false;
            foreach (string key in baseline.Keys.Concat(current.Keys)
                .Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal))
            {
                double left;
                double right;
                bool hasLeft = baseline.TryGetValue(key, out left);
                bool hasRight = current.TryGetValue(key, out right);
                if (hasLeft && hasRight)
                {
                    double tolerance = Math.Max(
                        Math.Max(0, config.AbsoluteNumericTolerance),
                        Math.Max(Math.Abs(left), Math.Abs(right))
                            * Math.Max(0, config.RelativeNumericTolerance));
                    if (Math.Abs(left - right) <= tolerance) { continue; }
                }
                else if (!hasLeft && !hasRight)
                {
                    continue;
                }
                changed = true;
                differences.Add(new SemanticPropertyDifferenceRecord(
                    category, key,
                    hasLeft ? (object)left : null,
                    hasRight ? (object)right : null,
                    hasLeft && hasRight ? "outside_configured_numeric_tolerance"
                        : hasLeft ? "removed" : "added"));
            }
            return changed;
        }

        static bool CompareAssociationMaps(
            IDictionary<string, List<string>> baseline,
            IDictionary<string, List<string>> current,
            IList<SemanticPropertyDifferenceRecord> differences)
        {
            bool changed = false;
            foreach (string key in baseline.Keys.Concat(current.Keys)
                .Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal))
            {
                List<string> left;
                List<string> right;
                bool hasLeft = baseline.TryGetValue(key, out left);
                bool hasRight = current.TryGetValue(key, out right);
                string leftValue = hasLeft ? string.Join("\u001f", left) : "";
                string rightValue = hasRight ? string.Join("\u001f", right) : "";
                if (hasLeft == hasRight && leftValue == rightValue) { continue; }
                changed = true;
                differences.Add(new SemanticPropertyDifferenceRecord(
                    "association", key,
                    hasLeft ? (object)new List<string>(left) : null,
                    hasRight ? (object)new List<string>(right) : null,
                    hasLeft && hasRight ? "changed" : hasLeft ? "removed" : "added"));
            }
            return changed;
        }

        static List<SemanticDrawingSynchronizationCandidateRecord> BuildSynchronizationCandidates(
            IList<SemanticDrawingElementChangeRecord> changes,
            SemanticDrawingDiffConfig config,
            IList<SemanticDrawingDiffDiagnosticRecord> diagnostics)
        {
            var result = new List<SemanticDrawingSynchronizationCandidateRecord>();
            int maximum = Math.Max(1, config.MaximumSynchronizationCandidateCount);
            foreach (SemanticDrawingElementChangeRecord change in changes.Where(value =>
                value.Domain == "dimension_binding" && !value.IsUnchanged))
            {
                bool geometry = change.ChangeKinds.Contains("geometry_changed")
                    || change.ChangeKinds.Contains("moved");
                bool semantic = change.ChangeKinds.Contains("semantic_value_changed");
                string kind = geometry && !semantic
                    ? "bound_geometry_changed_without_dimension_value_change_candidate"
                    : semantic && !geometry
                        ? "dimension_value_changed_without_bound_geometry_change_candidate"
                        : "";
                if (string.IsNullOrEmpty(kind)) { continue; }
                result.Add(new SemanticDrawingSynchronizationCandidateRecord(
                    "semantic-sync:" + SemanticDrawingDiffMaps.Hash(new[] { kind, change.Id }),
                    kind,
                    "same_dimension_binding",
                    new[] { change.Id },
                    change.RelationKeys,
                    geometry
                        ? "The bound structural span changed while the dimension semantic value stayed stable; review whether this is intentional."
                        : "The dimension semantic value changed while the bound structural span stayed stable; review whether this is intentional."));
                if (result.Count >= maximum) { break; }
            }

            var structuralByRelation = new Dictionary<string, List<SemanticDrawingElementChangeRecord>>(
                StringComparer.Ordinal);
            foreach (SemanticDrawingElementChangeRecord change in changes.Where(value =>
                !value.IsUnchanged && IsStructuralDomain(value.Domain)))
            {
                foreach (string relation in change.RelationKeys.Where(value =>
                    value.StartsWith("source_handle:", StringComparison.Ordinal)))
                {
                    List<SemanticDrawingElementChangeRecord> values;
                    if (!structuralByRelation.TryGetValue(relation, out values))
                    {
                        values = new List<SemanticDrawingElementChangeRecord>();
                        structuralByRelation[relation] = values;
                    }
                    values.Add(change);
                }
            }
            foreach (SemanticDrawingElementChangeRecord semantic in changes.Where(value =>
                value.IsUnchanged && (value.Domain == "dimension_binding" || value.Domain == "annotation")))
            {
                foreach (string relation in semantic.RelationKeys.Where(value =>
                    value.StartsWith("source_handle:", StringComparison.Ordinal)))
                {
                    List<SemanticDrawingElementChangeRecord> structural;
                    if (!structuralByRelation.TryGetValue(relation, out structural)) { continue; }
                    var related = structural.Concat(new[] { semantic }).ToList();
                    string kind = "structural_source_changed_with_unchanged_annotation_candidate";
                    result.Add(new SemanticDrawingSynchronizationCandidateRecord(
                        "semantic-sync:" + SemanticDrawingDiffMaps.Hash(new[]
                        {
                            kind,
                            relation,
                            semantic.Id
                        }),
                        kind,
                        "shared_authored_source_handle",
                        related.Select(value => value.Id),
                        new[] { relation },
                        "A structural element changed while a directly source-linked annotation remained unchanged; review the authored relationship before calling this a missed update."));
                    if (result.Count >= maximum) { break; }
                }
                if (result.Count >= maximum) { break; }
            }
            if (result.Count >= maximum)
            {
                diagnostics.Add(new SemanticDrawingDiffDiagnosticRecord(
                    "SYNCHRONIZATION_CANDIDATE_LIMIT_REACHED",
                    "unsupported",
                    "semantic-synchronization",
                    "Synchronization review candidates were truncated at the configured limit."));
            }
            return result.GroupBy(value => value.Id, StringComparer.Ordinal)
                .Select(group => group.First()).ToList();
        }

        static bool IsStructuralDomain(string domain)
        {
            return domain == "geometry_occurrence"
                || domain == "manufacturing_profile"
                || domain == "interface_feature";
        }

        static List<SemanticDrawingIssueLifecycleRecord> BuildIssueLifecycles(
            IList<SemanticDrawingIssueObservation> baseline,
            IList<SemanticDrawingIssueObservation> current,
            IList<SemanticDrawingDiffDiagnosticRecord> diagnostics)
        {
            Dictionary<string, SemanticDrawingIssueObservation> left = UniqueIssues(
                baseline, "baseline", diagnostics);
            Dictionary<string, SemanticDrawingIssueObservation> right = UniqueIssues(
                current, "current", diagnostics);
            var result = new List<SemanticDrawingIssueLifecycleRecord>();
            foreach (string key in left.Keys.Concat(right.Keys)
                .Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal))
            {
                SemanticDrawingIssueObservation leftValue;
                SemanticDrawingIssueObservation rightValue;
                bool hasLeft = left.TryGetValue(key, out leftValue);
                bool hasRight = right.TryGetValue(key, out rightValue);
                string lifecycle = hasLeft && hasRight
                    ? (leftValue.State == rightValue.State
                        ? "persisting"
                        : "persisting_state_changed")
                    : hasRight ? "new_candidate" : "closed_or_not_reproduced_candidate";
                result.Add(new SemanticDrawingIssueLifecycleRecord(
                    key, lifecycle, leftValue, rightValue));
            }
            return result;
        }

        static Dictionary<string, SemanticDrawingIssueObservation> UniqueIssues(
            IEnumerable<SemanticDrawingIssueObservation> issues,
            string side,
            IList<SemanticDrawingDiffDiagnosticRecord> diagnostics)
        {
            var result = new Dictionary<string, SemanticDrawingIssueObservation>(StringComparer.Ordinal);
            foreach (IGrouping<string, SemanticDrawingIssueObservation> group in issues
                .Where(value => !string.IsNullOrEmpty(value.IssueKey))
                .GroupBy(value => value.IssueKey, StringComparer.Ordinal))
            {
                if (group.Count() == 1)
                {
                    result[group.Key] = group.First();
                }
                else
                {
                    diagnostics.Add(new SemanticDrawingDiffDiagnosticRecord(
                        "DUPLICATE_ISSUE_KEY",
                        "ambiguous",
                        side + ":" + group.Key,
                        "Issue lifecycle was not inferred for a duplicate issue key."));
                }
            }
            return result;
        }

        static List<SemanticDrawingDiffRegionRecord> BuildChangeRegions(
            IList<SemanticDrawingElementChangeRecord> changes,
            double drawingSpan,
            SemanticDrawingDiffConfig config,
            IList<SemanticDrawingDiffDiagnosticRecord> diagnostics)
        {
            double gap = Math.Max(0, drawingSpan) * Math.Max(0, config.ChangeRegionGapRatio);
            int maximum = Math.Max(1, config.MaximumChangeRegionCount);
            var clusters = new List<RegionCluster>();
            foreach (SemanticDrawingElementChangeRecord change in changes
                .Where(value => !value.IsUnchanged && value.ChangeBounds != null)
                .OrderBy(value => value.ChangeBounds[0])
                .ThenBy(value => value.ChangeBounds[1]))
            {
                double[] bounds = change.ChangeBounds;
                RegionCluster cluster = clusters.FirstOrDefault(value => OverlapsWithinGap(
                    value.MinX, value.MinY, value.MaxX, value.MaxY,
                    bounds[0], bounds[1], bounds[2], bounds[3], gap));
                if (cluster == null)
                {
                    if (clusters.Count >= maximum)
                    {
                        diagnostics.Add(new SemanticDrawingDiffDiagnosticRecord(
                            "CHANGE_REGION_LIMIT_REACHED",
                            "unsupported",
                            change.Id,
                            "Change-region clustering was truncated at the configured region limit."));
                        break;
                    }
                    cluster = new RegionCluster
                    {
                        MinX = bounds[0], MinY = bounds[1], MaxX = bounds[2], MaxY = bounds[3]
                    };
                    clusters.Add(cluster);
                }
                else
                {
                    cluster.MinX = Math.Min(cluster.MinX, bounds[0]);
                    cluster.MinY = Math.Min(cluster.MinY, bounds[1]);
                    cluster.MaxX = Math.Max(cluster.MaxX, bounds[2]);
                    cluster.MaxY = Math.Max(cluster.MaxY, bounds[3]);
                }
                cluster.Changes.Add(change);
            }
            return clusters.Select(value => new SemanticDrawingDiffRegionRecord(
                "semantic-diff-region:" + SemanticDrawingDiffMaps.Hash(
                    value.Changes.Select(change => change.Id).OrderBy(id => id, StringComparer.Ordinal)),
                value.MinX, value.MinY, value.MaxX, value.MaxY, value.Changes)).ToList();
        }

        static bool OverlapsWithinGap(
            double aMinX, double aMinY, double aMaxX, double aMaxY,
            double bMinX, double bMinY, double bMaxX, double bMaxY,
            double gap)
        {
            return aMinX <= bMaxX + gap && aMaxX + gap >= bMinX
                && aMinY <= bMaxY + gap && aMaxY + gap >= bMinY;
        }

        static double[] UnionChangeBounds(
            SemanticDrawingElementObservation baseline,
            SemanticDrawingElementObservation current,
            SemanticDrawingAlignmentObservation alignment)
        {
            double[] left = baseline != null && baseline.HasBounds
                ? alignment.TransformBounds(baseline.MinX, baseline.MinY, baseline.MaxX, baseline.MaxY)
                : null;
            double[] right = current != null && current.HasBounds
                ? new[] { current.MinX, current.MinY, current.MaxX, current.MaxY }
                : null;
            if (left == null) { return right; }
            if (right == null) { return left; }
            return new[]
            {
                Math.Min(left[0], right[0]),
                Math.Min(left[1], right[1]),
                Math.Max(left[2], right[2]),
                Math.Max(left[3], right[3])
            };
        }

        static double DrawingSpan(IEnumerable<SemanticDrawingElementObservation> elements)
        {
            List<SemanticDrawingElementObservation> bounded = elements
                .Where(value => value.HasBounds).ToList();
            if (bounded.Count == 0) { return 1; }
            double minX = bounded.Min(value => value.MinX);
            double minY = bounded.Min(value => value.MinY);
            double maxX = bounded.Max(value => value.MaxX);
            double maxY = bounded.Max(value => value.MaxY);
            return Math.Max(1, Distance(minX, minY, maxX, maxY));
        }

        static double Median(IEnumerable<double> values)
        {
            List<double> ordered = values.OrderBy(value => value).ToList();
            if (ordered.Count == 0) { return 0; }
            int middle = ordered.Count / 2;
            return ordered.Count % 2 == 1
                ? ordered[middle]
                : (ordered[middle - 1] + ordered[middle]) * 0.5;
        }

        static double Distance(double x1, double y1, double x2, double y2)
        {
            double dx = x2 - x1;
            double dy = y2 - y1;
            return Math.Sqrt(dx * dx + dy * dy);
        }
    }

    internal static class SemanticDrawingDiffMaps
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

        public static bool IsFinite(double value)
        {
            return !double.IsNaN(value) && !double.IsInfinity(value);
        }

        public static List<string> SortedUnique(IEnumerable<string> values)
        {
            return values == null
                ? new List<string>()
                : values.Where(value => !string.IsNullOrWhiteSpace(value))
                    .Distinct(StringComparer.Ordinal)
                    .OrderBy(value => value, StringComparer.Ordinal)
                    .ToList();
        }

        public static string NormalizeIdentity(string value)
        {
            if (string.IsNullOrWhiteSpace(value)) { return ""; }
            var builder = new StringBuilder();
            foreach (char character in value.Trim().ToUpperInvariant())
            {
                if (!char.IsWhiteSpace(character)
                    && character != '-'
                    && character != '_'
                    && character != '.'
                    && character != '—')
                {
                    builder.Append(character);
                }
            }
            return builder.ToString();
        }

        public static string Hash(IEnumerable<string> values)
        {
            string joined = string.Join("\u001f", values ?? Enumerable.Empty<string>());
            using (SHA256 sha = SHA256.Create())
            {
                byte[] bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(joined));
                var builder = new StringBuilder();
                for (int index = 0; index < 12; index++)
                {
                    builder.Append(bytes[index].ToString("x2", CultureInfo.InvariantCulture));
                }
                return builder.ToString();
            }
        }

        public static string StableDouble(double value, double tolerance)
        {
            if (!IsFinite(value)) { return "nan"; }
            double quantum = Math.Max(Math.Abs(tolerance), 0.000000000001);
            long quantized = checked((long)Math.Round(value / quantum, MidpointRounding.AwayFromZero));
            return quantized.ToString(CultureInfo.InvariantCulture);
        }
    }
}
