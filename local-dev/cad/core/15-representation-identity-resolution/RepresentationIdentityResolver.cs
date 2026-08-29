using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace Shb.Cad.Core
{
    public static class RepresentationIdentityEdgeTypes
    {
        public const string SameObjectSupported = "same_object_supported";
        public const string SameObjectPossible = "same_object_possible";
        public const string DifferentObjectProven = "different_object_proven";
        public const string SameTypeOnly = "same_type_only";
        public const string RepresentsType = "represents_type";
    }

    public static class IdentityRepresentationModes
    {
        public const string EngineeringView = "engineering_view_representation";
        public const string SchematicInstance = "schematic_instance";
        public const string AggregatedPhysical = "aggregated_physical_representation";
        public const string ScheduleRecord = "schedule_record";
        public const string TypeDetail = "type_detail";
        public const string LegendSymbol = "legend_symbol";
    }

    public sealed class RepresentationIdentityConfig
    {
        public RepresentationIdentityConfig()
        {
            MaximumRepresentationCount = 2000;
            MaximumAssertionCount = 100000;
            IncludeSingletonPhysicalClusters = true;
        }

        public int MaximumRepresentationCount { get; set; }
        public int MaximumAssertionCount { get; set; }
        public bool IncludeSingletonPhysicalClusters { get; set; }
    }

    public sealed class IdentityRepresentationObservation
    {
        readonly List<string> labelTexts;
        readonly List<string> sourceIds;

        public IdentityRepresentationObservation(
            string id,
            string mode,
            string semanticClass,
            string contextId,
            string invariantSignatureId,
            IEnumerable<string> labels,
            IEnumerable<string> sources)
        {
            Id = id ?? "";
            Mode = mode ?? "";
            SemanticClass = semanticClass ?? "";
            ContextId = contextId ?? "";
            InvariantSignatureId = invariantSignatureId ?? "";
            labelTexts = IdentityMaps.SortedUnique(labels);
            sourceIds = IdentityMaps.SortedUnique(sources);
        }

        public string Id { get; private set; }
        public string Mode { get; private set; }
        public string SemanticClass { get; private set; }
        public string ContextId { get; private set; }
        public string InvariantSignatureId { get; private set; }
        public IList<string> LabelTexts { get { return labelTexts.AsReadOnly(); } }
        public IList<string> SourceIds { get { return sourceIds.AsReadOnly(); } }
    }

    public sealed class RepresentationIdentityEvidenceObservation
    {
        readonly List<string> sourceIds;

        public RepresentationIdentityEvidenceObservation(
            string id,
            string leftRepresentationId,
            string rightRepresentationId,
            string edgeType,
            string status,
            string evidenceGrade,
            string sourceKind,
            IEnumerable<string> sources,
            string message)
        {
            Id = id ?? "";
            LeftRepresentationId = leftRepresentationId ?? "";
            RightRepresentationId = rightRepresentationId ?? "";
            EdgeType = edgeType ?? "";
            Status = status ?? "ambiguous";
            EvidenceGrade = evidenceGrade ?? "";
            SourceKind = sourceKind ?? "";
            sourceIds = IdentityMaps.SortedUnique(sources);
            Message = message ?? "";
        }

        public string Id { get; private set; }
        public string LeftRepresentationId { get; private set; }
        public string RightRepresentationId { get; private set; }
        public string EdgeType { get; private set; }
        public string Status { get; private set; }
        public string EvidenceGrade { get; private set; }
        public string SourceKind { get; private set; }
        public IList<string> SourceIds { get { return sourceIds.AsReadOnly(); } }
        public string Message { get; private set; }
    }

    public sealed class IdentityRepresentationRecord
    {
        readonly List<string> labelTexts;
        readonly List<string> sourceIds;

        internal IdentityRepresentationRecord(
            string id,
            string origin,
            string mode,
            string semanticClass,
            string contextId,
            string regionId,
            string invariantSignatureId,
            IEnumerable<string> labels,
            IEnumerable<string> sources)
        {
            Id = id ?? "";
            Origin = origin ?? "";
            Mode = mode ?? "";
            SemanticClass = semanticClass ?? "";
            ContextId = contextId ?? "";
            RegionId = regionId ?? "";
            InvariantSignatureId = invariantSignatureId ?? "";
            labelTexts = IdentityMaps.SortedUnique(labels);
            sourceIds = IdentityMaps.SortedUnique(sources);
        }

        public string Id { get; private set; }
        public string Origin { get; private set; }
        public string Mode { get; private set; }
        public string SemanticClass { get; private set; }
        public string ContextId { get; private set; }
        public string RegionId { get; private set; }
        public string InvariantSignatureId { get; private set; }
        public IList<string> LabelTexts { get { return labelTexts.AsReadOnly(); } }
        public IList<string> SourceIds { get { return sourceIds.AsReadOnly(); } }
        public bool IsPhysical
        {
            get
            {
                return Mode == IdentityRepresentationModes.EngineeringView
                    || Mode == IdentityRepresentationModes.SchematicInstance
                    || Mode == IdentityRepresentationModes.AggregatedPhysical;
            }
        }
        public bool IsSchedule { get { return Mode == IdentityRepresentationModes.ScheduleRecord; } }
        public bool IsTypeReference
        {
            get
            {
                return Mode == IdentityRepresentationModes.TypeDetail
                    || Mode == IdentityRepresentationModes.LegendSymbol;
            }
        }

        public Dictionary<string, object> ToMap()
        {
            return IdentityMaps.Map(
                "representation_id", Id,
                "origin", Origin,
                "mode", Mode,
                "semantic_class", SemanticClass,
                "context_id", ContextId,
                "region_id", RegionId,
                "invariant_signature_id", InvariantSignatureId,
                "label_texts", new List<string>(labelTexts),
                "source_ids", new List<string>(sourceIds),
                "is_physical_representation", IsPhysical,
                "is_schedule_record", IsSchedule,
                "is_type_reference", IsTypeReference);
        }
    }

    public sealed class RepresentationIdentityAssertionRecord
    {
        readonly List<string> sourceIds;

        internal RepresentationIdentityAssertionRecord(
            string id,
            string left,
            string right,
            string edgeType,
            string status,
            string evidenceGrade,
            string origin,
            string sourceKind,
            IEnumerable<string> sources,
            string message,
            double score)
        {
            Id = id ?? "";
            LeftRepresentationId = left ?? "";
            RightRepresentationId = right ?? "";
            EdgeType = edgeType ?? "";
            Status = status ?? "ambiguous";
            EvidenceGrade = evidenceGrade ?? "";
            Origin = origin ?? "";
            SourceKind = sourceKind ?? "";
            sourceIds = IdentityMaps.SortedUnique(sources);
            Message = message ?? "";
            Score = score;
        }

        public string Id { get; private set; }
        public string LeftRepresentationId { get; private set; }
        public string RightRepresentationId { get; private set; }
        public string EdgeType { get; private set; }
        public string Status { get; private set; }
        public string EvidenceGrade { get; private set; }
        public string Origin { get; private set; }
        public string SourceKind { get; private set; }
        public IList<string> SourceIds { get { return sourceIds.AsReadOnly(); } }
        public string Message { get; private set; }
        public double Score { get; private set; }
        public bool IsMergeEligible
        {
            get
            {
                return EdgeType == RepresentationIdentityEdgeTypes.SameObjectSupported
                    && Status == "supported"
                    && Origin == "external_evidence";
            }
        }

        public Dictionary<string, object> ToMap()
        {
            return IdentityMaps.Map(
                "assertion_id", Id,
                "left_representation_id", LeftRepresentationId,
                "right_representation_id", RightRepresentationId,
                "edge_type", EdgeType,
                "status", Status,
                "evidence_grade", EvidenceGrade,
                "origin", Origin,
                "source_kind", SourceKind,
                "source_ids", new List<string>(sourceIds),
                "message", Message,
                "score", Score,
                "merge_eligible", IsMergeEligible);
        }
    }

    public sealed class ResolvedPhysicalObjectClusterRecord
    {
        readonly List<string> representationIds;
        readonly List<string> attachedScheduleRecordIds;
        readonly List<string> supportingAssertionIds;

        internal ResolvedPhysicalObjectClusterRecord(
            string id,
            IEnumerable<string> representations,
            IEnumerable<string> scheduleRecords,
            IEnumerable<string> assertions)
        {
            Id = id ?? "";
            representationIds = IdentityMaps.SortedUnique(representations);
            attachedScheduleRecordIds = IdentityMaps.SortedUnique(scheduleRecords);
            supportingAssertionIds = IdentityMaps.SortedUnique(assertions);
            Status = representationIds.Count > 1
                ? "resolved_by_supported_identity"
                : "conservative_singleton";
        }

        public string Id { get; private set; }
        public string Status { get; private set; }
        public IList<string> RepresentationIds { get { return representationIds.AsReadOnly(); } }
        public IList<string> AttachedScheduleRecordIds { get { return attachedScheduleRecordIds.AsReadOnly(); } }
        public IList<string> SupportingAssertionIds { get { return supportingAssertionIds.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return IdentityMaps.Map(
                "cluster_id", Id,
                "status", Status,
                "representation_ids", new List<string>(representationIds),
                "representation_count", representationIds.Count,
                "attached_schedule_record_ids", new List<string>(attachedScheduleRecordIds),
                "supporting_assertion_ids", new List<string>(supportingAssertionIds),
                "identity_boundary", representationIds.Count > 1
                    ? "merged_only_by_independent_same_object_supported_evidence"
                    : "absence_of_merge_is_not_proof_of_different_objects");
        }
    }

    public sealed class IdentityCandidateGroupRecord
    {
        readonly List<string> representationIds;
        readonly List<string> resolvedClusterIds;
        readonly List<string> assertionIds;
        readonly List<string> conflictingConstraintIds;

        internal IdentityCandidateGroupRecord(
            string id,
            IEnumerable<string> representations,
            IEnumerable<string> clusters,
            IEnumerable<string> assertions,
            IEnumerable<string> conflicts)
        {
            Id = id ?? "";
            representationIds = IdentityMaps.SortedUnique(representations);
            resolvedClusterIds = IdentityMaps.SortedUnique(clusters);
            assertionIds = IdentityMaps.SortedUnique(assertions);
            conflictingConstraintIds = IdentityMaps.SortedUnique(conflicts);
            Status = conflictingConstraintIds.Count == 0
                ? "candidate_only_not_merged"
                : "candidate_conflicts_with_different_object_constraint";
        }

        public string Id { get; private set; }
        public string Status { get; private set; }
        public IList<string> RepresentationIds { get { return representationIds.AsReadOnly(); } }
        public IList<string> ResolvedPhysicalClusterIds { get { return resolvedClusterIds.AsReadOnly(); } }
        public IList<string> AssertionIds { get { return assertionIds.AsReadOnly(); } }
        public IList<string> ConflictingConstraintIds { get { return conflictingConstraintIds.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return IdentityMaps.Map(
                "candidate_group_id", Id,
                "status", Status,
                "representation_ids", new List<string>(representationIds),
                "resolved_physical_cluster_ids", new List<string>(resolvedClusterIds),
                "assertion_ids", new List<string>(assertionIds),
                "conflicting_constraint_ids", new List<string>(conflictingConstraintIds),
                "merge_status", "not_merged_without_same_object_supported");
        }
    }

    public sealed class IdentityTypeCandidateGroupRecord
    {
        readonly List<string> representationIds;
        readonly List<string> signatureIds;
        readonly List<string> assertionIds;

        internal IdentityTypeCandidateGroupRecord(
            string id,
            IEnumerable<string> representations,
            IEnumerable<string> signatures,
            IEnumerable<string> assertions)
        {
            Id = id ?? "";
            representationIds = IdentityMaps.SortedUnique(representations);
            signatureIds = IdentityMaps.SortedUnique(signatures);
            assertionIds = IdentityMaps.SortedUnique(assertions);
        }

        public string Id { get; private set; }
        public string Status { get { return "same_type_candidate_only"; } }
        public IList<string> RepresentationIds { get { return representationIds.AsReadOnly(); } }
        public IList<string> InvariantSignatureIds { get { return signatureIds.AsReadOnly(); } }
        public IList<string> AssertionIds { get { return assertionIds.AsReadOnly(); } }

        public Dictionary<string, object> ToMap()
        {
            return IdentityMaps.Map(
                "type_candidate_group_id", Id,
                "status", Status,
                "representation_ids", new List<string>(representationIds),
                "invariant_signature_ids", new List<string>(signatureIds),
                "assertion_ids", new List<string>(assertionIds),
                "object_identity_effect", "none");
        }
    }

    public sealed class BlockedIdentityMergeRecord
    {
        readonly List<string> leftClusterRepresentationIds;
        readonly List<string> rightClusterRepresentationIds;
        readonly List<string> blockingConstraintIds;

        internal BlockedIdentityMergeRecord(
            string assertionId,
            IEnumerable<string> left,
            IEnumerable<string> right,
            IEnumerable<string> constraints,
            string reason)
        {
            AssertionId = assertionId ?? "";
            leftClusterRepresentationIds = IdentityMaps.SortedUnique(left);
            rightClusterRepresentationIds = IdentityMaps.SortedUnique(right);
            blockingConstraintIds = IdentityMaps.SortedUnique(constraints);
            Reason = reason ?? "";
        }

        public string AssertionId { get; private set; }
        public IList<string> LeftClusterRepresentationIds { get { return leftClusterRepresentationIds.AsReadOnly(); } }
        public IList<string> RightClusterRepresentationIds { get { return rightClusterRepresentationIds.AsReadOnly(); } }
        public IList<string> BlockingConstraintIds { get { return blockingConstraintIds.AsReadOnly(); } }
        public string Reason { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return IdentityMaps.Map(
                "assertion_id", AssertionId,
                "left_cluster_representation_ids", new List<string>(leftClusterRepresentationIds),
                "right_cluster_representation_ids", new List<string>(rightClusterRepresentationIds),
                "blocking_constraint_ids", new List<string>(blockingConstraintIds),
                "reason", Reason);
        }
    }

    public sealed class ScheduleIdentityResolutionRecord
    {
        readonly List<string> candidateClusterIds;
        readonly List<string> supportingAssertionIds;

        internal ScheduleIdentityResolutionRecord(
            string scheduleRecordId,
            string status,
            string clusterId,
            IEnumerable<string> candidates,
            IEnumerable<string> assertions,
            string message)
        {
            ScheduleRecordId = scheduleRecordId ?? "";
            Status = status ?? "unresolved";
            ResolvedPhysicalClusterId = clusterId ?? "";
            candidateClusterIds = IdentityMaps.SortedUnique(candidates);
            supportingAssertionIds = IdentityMaps.SortedUnique(assertions);
            Message = message ?? "";
        }

        public string ScheduleRecordId { get; private set; }
        public string Status { get; private set; }
        public string ResolvedPhysicalClusterId { get; private set; }
        public IList<string> CandidateClusterIds { get { return candidateClusterIds.AsReadOnly(); } }
        public IList<string> SupportingAssertionIds { get { return supportingAssertionIds.AsReadOnly(); } }
        public string Message { get; private set; }

        public Dictionary<string, object> ToMap()
        {
            return IdentityMaps.Map(
                "schedule_record_id", ScheduleRecordId,
                "status", Status,
                "resolved_physical_cluster_id", ResolvedPhysicalClusterId,
                "candidate_cluster_ids", new List<string>(candidateClusterIds),
                "supporting_assertion_ids", new List<string>(supportingAssertionIds),
                "message", Message);
        }
    }

    public sealed class RepresentationIdentityDiagnosticRecord
    {
        internal RepresentationIdentityDiagnosticRecord(
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
            return IdentityMaps.Map(
                "code", Code,
                "status", Status,
                "source_id", SourceId,
                "message", Message);
        }
    }

    public sealed class RepresentationIdentityResolutionDocument
    {
        readonly List<IdentityRepresentationRecord> representations;
        readonly List<RepresentationIdentityAssertionRecord> assertions;
        readonly List<ResolvedPhysicalObjectClusterRecord> physicalClusters;
        readonly List<IdentityCandidateGroupRecord> possibleGroups;
        readonly List<IdentityTypeCandidateGroupRecord> typeGroups;
        readonly List<BlockedIdentityMergeRecord> blockedMerges;
        readonly List<ScheduleIdentityResolutionRecord> scheduleResolutions;
        readonly List<RepresentationIdentityDiagnosticRecord> diagnostics;

        internal RepresentationIdentityResolutionDocument(
            string drawingId,
            IEnumerable<IdentityRepresentationRecord> representationValues,
            IEnumerable<RepresentationIdentityAssertionRecord> assertionValues,
            IEnumerable<ResolvedPhysicalObjectClusterRecord> clusterValues,
            IEnumerable<IdentityCandidateGroupRecord> possibleValues,
            IEnumerable<IdentityTypeCandidateGroupRecord> typeValues,
            IEnumerable<BlockedIdentityMergeRecord> blockedValues,
            IEnumerable<ScheduleIdentityResolutionRecord> scheduleValues,
            IEnumerable<RepresentationIdentityDiagnosticRecord> diagnosticValues)
        {
            DrawingId = drawingId ?? "";
            representations = Copy(representationValues);
            assertions = Copy(assertionValues);
            physicalClusters = Copy(clusterValues);
            possibleGroups = Copy(possibleValues);
            typeGroups = Copy(typeValues);
            blockedMerges = Copy(blockedValues);
            scheduleResolutions = Copy(scheduleValues);
            diagnostics = Copy(diagnosticValues);
            Status = diagnostics.Any(value => value.Status == "unsupported")
                ? "unsupported_partial"
                : blockedMerges.Count > 0
                    ? "conflicted"
                    : representations.Count == 0
                        ? "ambiguous"
                        : "computed";
        }

        public string DrawingId { get; private set; }
        public string Status { get; private set; }
        public IList<IdentityRepresentationRecord> Representations { get { return representations.AsReadOnly(); } }
        public IList<RepresentationIdentityAssertionRecord> Assertions { get { return assertions.AsReadOnly(); } }
        public IList<ResolvedPhysicalObjectClusterRecord> PhysicalObjectClusters { get { return physicalClusters.AsReadOnly(); } }
        public IList<IdentityCandidateGroupRecord> SameObjectPossibleGroups { get { return possibleGroups.AsReadOnly(); } }
        public IList<IdentityTypeCandidateGroupRecord> TypeCandidateGroups { get { return typeGroups.AsReadOnly(); } }
        public IList<BlockedIdentityMergeRecord> BlockedMerges { get { return blockedMerges.AsReadOnly(); } }
        public IList<ScheduleIdentityResolutionRecord> ScheduleResolutions { get { return scheduleResolutions.AsReadOnly(); } }
        public IList<RepresentationIdentityDiagnosticRecord> Diagnostics { get { return diagnostics.AsReadOnly(); } }
        public int SupportedObjectAssertionCount
        {
            get { return assertions.Count(value => value.IsMergeEligible); }
        }
        public int PossibleObjectAssertionCount
        {
            get { return assertions.Count(value => value.EdgeType == RepresentationIdentityEdgeTypes.SameObjectPossible); }
        }
        public int DifferentObjectConstraintCount
        {
            get
            {
                return assertions.Count(value =>
                    value.EdgeType == RepresentationIdentityEdgeTypes.DifferentObjectProven
                    && value.Status == "supported");
            }
        }
        public int MergedPhysicalObjectClusterCount
        {
            get { return physicalClusters.Count(value => value.RepresentationIds.Count > 1); }
        }

        public Dictionary<string, object> ToMap()
        {
            return IdentityMaps.Map(
                "schema_version", "1",
                "analysis_type", "representation_identity_resolution",
                "analyzer_version", "1",
                "drawing_id", DrawingId,
                "status", Status,
                "representation_count", representations.Count,
                "physical_representation_count", representations.Count(value => value.IsPhysical),
                "schedule_record_count", representations.Count(value => value.IsSchedule),
                "assertion_count", assertions.Count,
                "same_object_supported_assertion_count", SupportedObjectAssertionCount,
                "same_object_possible_assertion_count", PossibleObjectAssertionCount,
                "different_object_constraint_count", DifferentObjectConstraintCount,
                "physical_object_cluster_count", physicalClusters.Count,
                "merged_physical_object_cluster_count", MergedPhysicalObjectClusterCount,
                "same_object_possible_group_count", possibleGroups.Count,
                "type_candidate_group_count", typeGroups.Count,
                "blocked_merge_count", blockedMerges.Count,
                "representations", representations.Select(value => value.ToMap()).ToList(),
                "identity_assertions", assertions.Select(value => value.ToMap()).ToList(),
                "physical_object_clusters", physicalClusters.Select(value => value.ToMap()).ToList(),
                "same_object_possible_groups", possibleGroups.Select(value => value.ToMap()).ToList(),
                "type_candidate_groups", typeGroups.Select(value => value.ToMap()).ToList(),
                "blocked_merges", blockedMerges.Select(value => value.ToMap()).ToList(),
                "schedule_resolutions", scheduleResolutions.Select(value => value.ToMap()).ToList(),
                "diagnostics", diagnostics.Select(value => value.ToMap()).ToList(),
                "semantic_contract", IdentityMaps.Map(
                    "object_merge", "independent_same_object_supported_evidence_only",
                    "same_object_possible", "visible_candidate_group_never_merged",
                    "same_type_only", "separate_type_candidate_group_no_object_identity_effect",
                    "different_object_proven", "hard_direct_and_transitive_merge_constraint",
                    "singleton_cluster", "unresolved_identity_not_proof_of_different_objects",
                    "geometry_or_projection_only", "never_same_object_supported"),
                "mutation_status", "read_only_no_entities_modified");
        }

        public string ToMarkdown()
        {
            var builder = new StringBuilder();
            builder.AppendLine("# 表示身份解析");
            builder.AppendLine();
            builder.AppendLine("- 图纸：`" + DrawingId + "`");
            builder.AppendLine("- 状态：`" + Status + "`");
            builder.AppendLine("- 表示 / 身份断言："
                + representations.Count.ToString(CultureInfo.InvariantCulture)
                + " / " + assertions.Count.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine("- 物理对象簇 / 实际合并簇："
                + physicalClusters.Count.ToString(CultureInfo.InvariantCulture)
                + " / " + MergedPhysicalObjectClusterCount.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine("- 同一对象候选组 / 同型候选组："
                + possibleGroups.Count.ToString(CultureInfo.InvariantCulture)
                + " / " + typeGroups.Count.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine("- 阻断合并：" + blockedMerges.Count.ToString(CultureInfo.InvariantCulture));
            builder.AppendLine();
            builder.AppendLine("只有带独立来源的 same_object_supported 才合并；投影对齐、重复几何和相似几何只保留为候选。单例簇表示证据不足，不表示对象彼此不同。");
            return builder.ToString().TrimEnd();
        }

        static List<T> Copy<T>(IEnumerable<T> values)
        {
            return values == null ? new List<T>() : values.ToList();
        }
    }

    public static class RepresentationIdentityResolver
    {
        sealed class DisjointSet
        {
            readonly Dictionary<string, string> parents =
                new Dictionary<string, string>(StringComparer.Ordinal);

            public void Add(string value)
            {
                if (!parents.ContainsKey(value)) { parents[value] = value; }
            }

            public string Find(string value)
            {
                string parent;
                if (!parents.TryGetValue(value, out parent)) { return ""; }
                if (parent == value) { return parent; }
                parents[value] = Find(parent);
                return parents[value];
            }

            public string Union(string left, string right)
            {
                string leftRoot = Find(left);
                string rightRoot = Find(right);
                if (leftRoot == rightRoot) { return leftRoot; }
                if (string.Compare(leftRoot, rightRoot, StringComparison.Ordinal) <= 0)
                {
                    parents[rightRoot] = leftRoot;
                    return leftRoot;
                }
                parents[leftRoot] = rightRoot;
                return rightRoot;
            }

            public IList<string> Values { get { return parents.Keys.OrderBy(value => value, StringComparer.Ordinal).ToList(); } }
        }

        public static RepresentationIdentityResolutionDocument Analyze(
            EngineeringViewRegionDocument regions,
            RepresentationCorrespondenceDocument correspondence,
            IEnumerable<IdentityRepresentationObservation> additionalRepresentations = null,
            IEnumerable<RepresentationIdentityEvidenceObservation> externalEvidence = null,
            RepresentationIdentityConfig config = null)
        {
            if (regions == null) { throw new ArgumentNullException("regions"); }
            if (correspondence == null) { throw new ArgumentNullException("correspondence"); }
            config = config ?? new RepresentationIdentityConfig();
            ValidateConfig(config);

            var diagnostics = new List<RepresentationIdentityDiagnosticRecord>();
            if (!string.Equals(regions.DrawingId, correspondence.DrawingId, StringComparison.Ordinal))
            {
                diagnostics.Add(new RepresentationIdentityDiagnosticRecord(
                    "DRAWING_ID_MISMATCH",
                    "unsupported",
                    correspondence.DrawingId,
                    "Engineering-region and representation-correspondence documents belong to different drawings."));
            }

            var signatures = correspondence.RegionSignatures
                .Where(value => value != null)
                .GroupBy(value => value.RegionId, StringComparer.Ordinal)
                .ToDictionary(group => group.Key, group => group.First().SignatureId, StringComparer.Ordinal);
            var representations = new List<IdentityRepresentationRecord>();
            var byId = new Dictionary<string, IdentityRepresentationRecord>(StringComparer.Ordinal);
            foreach (EngineeringViewRegionRecord region in regions.Regions
                .Where(value => value != null && value.IsEngineeringView)
                .OrderBy(value => value.Id, StringComparer.Ordinal))
            {
                if (representations.Count >= config.MaximumRepresentationCount)
                {
                    diagnostics.Add(new RepresentationIdentityDiagnosticRecord(
                        "REPRESENTATION_LIMIT_REACHED",
                        "unsupported",
                        region.Id,
                        "Engineering-view representations were truncated at the configured limit."));
                    break;
                }
                string signatureId;
                signatures.TryGetValue(region.Id, out signatureId);
                var record = new IdentityRepresentationRecord(
                    region.Id,
                    "engineering_view_regions",
                    IdentityRepresentationModes.EngineeringView,
                    "generic_engineering_view_scope",
                    regions.DrawingId,
                    region.Id,
                    signatureId,
                    region.LabelTexts,
                    new[] { region.Id });
                representations.Add(record);
                byId[record.Id] = record;
            }

            foreach (IdentityRepresentationObservation observation in (additionalRepresentations
                ?? Enumerable.Empty<IdentityRepresentationObservation>()))
            {
                if (observation == null) { continue; }
                if (representations.Count >= config.MaximumRepresentationCount)
                {
                    diagnostics.Add(new RepresentationIdentityDiagnosticRecord(
                        "REPRESENTATION_LIMIT_REACHED",
                        "unsupported",
                        observation.Id,
                        "Additional representations were truncated at the configured limit."));
                    break;
                }
                if (string.IsNullOrWhiteSpace(observation.Id))
                {
                    diagnostics.Add(new RepresentationIdentityDiagnosticRecord(
                        "REPRESENTATION_ID_MISSING", "unsupported", "",
                        "An additional representation without an ID was ignored."));
                    continue;
                }
                if (byId.ContainsKey(observation.Id))
                {
                    diagnostics.Add(new RepresentationIdentityDiagnosticRecord(
                        "DUPLICATE_REPRESENTATION_ID", "unsupported", observation.Id,
                        "An additional representation reused an existing ID and was ignored."));
                    continue;
                }
                var record = new IdentityRepresentationRecord(
                    observation.Id,
                    "external_observation",
                    observation.Mode,
                    observation.SemanticClass,
                    observation.ContextId,
                    "",
                    observation.InvariantSignatureId,
                    observation.LabelTexts,
                    observation.SourceIds);
                if (!record.IsPhysical && !record.IsSchedule && !record.IsTypeReference)
                {
                    diagnostics.Add(new RepresentationIdentityDiagnosticRecord(
                        "UNKNOWN_REPRESENTATION_MODE", "ambiguous", record.Id,
                        "The representation is retained but cannot participate in physical-object merging."));
                }
                representations.Add(record);
                byId[record.Id] = record;
            }

            var assertions = new List<RepresentationIdentityAssertionRecord>();
            bool assertionLimitReached = false;
            foreach (RepresentationCorrespondenceRelationRecord relation in correspondence.Relations
                .Where(value => value != null)
                .OrderBy(value => value.Id, StringComparer.Ordinal))
            {
                if (assertions.Count >= config.MaximumAssertionCount)
                {
                    assertionLimitReached = true;
                    break;
                }
                if (!byId.ContainsKey(relation.LeftRegionId) || !byId.ContainsKey(relation.RightRegionId))
                {
                    diagnostics.Add(new RepresentationIdentityDiagnosticRecord(
                        "CORRESPONDENCE_REPRESENTATION_MISSING", "unsupported", relation.Id,
                        "A correspondence relation references an engineering region unavailable to identity resolution."));
                    continue;
                }
                if (relation.Kind == "repeated_geometry_candidate"
                    || relation.Kind == "similar_geometry_candidate")
                {
                    assertions.Add(CreateAssertion(
                        relation.LeftRegionId,
                        relation.RightRegionId,
                        RepresentationIdentityEdgeTypes.SameTypeOnly,
                        relation.Kind == "repeated_geometry_candidate" ? "supported" : "ambiguous",
                        relation.Kind == "repeated_geometry_candidate"
                            ? "invariant_topology_signature"
                            : "bounded_geometry_similarity",
                        "representation_correspondence",
                        relation.Kind,
                        new[] { relation.Id },
                        "Geometry repetition supports a same-type candidate only; it does not support object identity.",
                        relation.Score));
                }
                else if (relation.Kind == "orthographic_projection_candidate"
                    && relation.IdentityInference == "same_object_possible")
                {
                    assertions.Add(CreateAssertion(
                        relation.LeftRegionId,
                        relation.RightRegionId,
                        RepresentationIdentityEdgeTypes.SameObjectPossible,
                        "supported",
                        "projection_station_alignment",
                        "representation_correspondence",
                        relation.Kind,
                        new[] { relation.Id },
                        "Projection alignment makes shared object identity possible but does not prove it.",
                        relation.Score));
                }
            }

            bool assertionLimitReported = false;
            foreach (RepresentationIdentityEvidenceObservation evidence in (externalEvidence
                ?? Enumerable.Empty<RepresentationIdentityEvidenceObservation>()))
            {
                if (evidence == null) { continue; }
                if (assertions.Count >= config.MaximumAssertionCount)
                {
                    assertionLimitReached = true;
                    if (!assertionLimitReported)
                    {
                        diagnostics.Add(new RepresentationIdentityDiagnosticRecord(
                            "ASSERTION_LIMIT_REACHED", "unsupported", evidence.Id,
                            "Identity assertions were truncated at the configured limit."));
                        assertionLimitReported = true;
                    }
                    break;
                }
                if (!IsAllowedEdgeType(evidence.EdgeType))
                {
                    diagnostics.Add(new RepresentationIdentityDiagnosticRecord(
                        "UNKNOWN_IDENTITY_EDGE_TYPE", "unsupported", evidence.Id,
                        "An external identity assertion used an unsupported edge type and was ignored."));
                    continue;
                }
                if (!byId.ContainsKey(evidence.LeftRepresentationId)
                    || !byId.ContainsKey(evidence.RightRepresentationId))
                {
                    diagnostics.Add(new RepresentationIdentityDiagnosticRecord(
                        "IDENTITY_EVIDENCE_REPRESENTATION_MISSING", "unsupported", evidence.Id,
                        "An external identity assertion references an unknown representation and was ignored."));
                    continue;
                }
                if (evidence.LeftRepresentationId == evidence.RightRepresentationId)
                {
                    diagnostics.Add(new RepresentationIdentityDiagnosticRecord(
                        "IDENTITY_SELF_EDGE_IGNORED", "unsupported", evidence.Id,
                        "A self-referential identity assertion was ignored."));
                    continue;
                }
                string status = NormalizeStatus(evidence.Status);
                if (status == "unsupported" && evidence.Status != "unsupported")
                {
                    diagnostics.Add(new RepresentationIdentityDiagnosticRecord(
                        "UNKNOWN_IDENTITY_EVIDENCE_STATUS", "unsupported", evidence.Id,
                        "An external identity assertion used an unknown status and was retained as unsupported."));
                }
                bool isHardAssertion = evidence.EdgeType == RepresentationIdentityEdgeTypes.SameObjectSupported
                    || evidence.EdgeType == RepresentationIdentityEdgeTypes.DifferentObjectProven;
                if (isHardAssertion && status == "supported"
                    && (string.IsNullOrWhiteSpace(evidence.EvidenceGrade)
                        || string.IsNullOrWhiteSpace(evidence.SourceKind)
                        || evidence.SourceIds.Count == 0))
                {
                    status = "unsupported";
                    diagnostics.Add(new RepresentationIdentityDiagnosticRecord(
                        "HARD_IDENTITY_EVIDENCE_TRACE_MISSING", "unsupported", evidence.Id,
                        "Supported identity merges and hard negative constraints require grade, source kind, and source IDs."));
                }
                if (evidence.EdgeType == RepresentationIdentityEdgeTypes.SameObjectSupported
                    && status == "supported" && !IsIndependentIdentitySource(evidence.SourceKind))
                {
                    status = "unsupported";
                    diagnostics.Add(new RepresentationIdentityDiagnosticRecord(
                        "NON_INDEPENDENT_IDENTITY_SUPPORT", "unsupported", evidence.Id,
                        "Geometry repetition, topology similarity, or projection alignment cannot independently support an object merge."));
                }
                assertions.Add(CreateAssertion(
                    evidence.LeftRepresentationId,
                    evidence.RightRepresentationId,
                    evidence.EdgeType,
                    status,
                    evidence.EvidenceGrade,
                    "external_evidence",
                    evidence.SourceKind,
                    evidence.SourceIds.Concat(string.IsNullOrEmpty(evidence.Id)
                        ? Enumerable.Empty<string>() : new[] { evidence.Id }),
                    evidence.Message,
                    0));
            }
            if (assertionLimitReached && !assertionLimitReported)
            {
                diagnostics.Add(new RepresentationIdentityDiagnosticRecord(
                    "ASSERTION_LIMIT_REACHED", "unsupported", "",
                    "Identity assertions reached the configured limit."));
            }
            assertions = CollapseDuplicateAssertions(assertions, diagnostics)
                .OrderBy(value => value.LeftRepresentationId, StringComparer.Ordinal)
                .ThenBy(value => value.RightRepresentationId, StringComparer.Ordinal)
                .ThenBy(value => value.EdgeType, StringComparer.Ordinal)
                .ThenBy(value => value.Id, StringComparer.Ordinal)
                .ToList();

            var physicalIds = representations.Where(value => value.IsPhysical)
                .Select(value => value.Id).OrderBy(value => value, StringComparer.Ordinal).ToList();
            var objectSet = new DisjointSet();
            foreach (string id in physicalIds) { objectSet.Add(id); }
            var forbidden = BuildForbiddenPairs(assertions, byId);
            var acceptedMergeAssertionIds = new HashSet<string>(StringComparer.Ordinal);
            var blockedMerges = new List<BlockedIdentityMergeRecord>();
            foreach (RepresentationIdentityAssertionRecord assertion in assertions
                .Where(value => value.IsMergeEligible)
                .OrderBy(value => value.LeftRepresentationId, StringComparer.Ordinal)
                .ThenBy(value => value.RightRepresentationId, StringComparer.Ordinal)
                .ThenBy(value => value.Id, StringComparer.Ordinal))
            {
                IdentityRepresentationRecord left = byId[assertion.LeftRepresentationId];
                IdentityRepresentationRecord right = byId[assertion.RightRepresentationId];
                if (!left.IsPhysical || !right.IsPhysical) { continue; }
                List<string> leftMembers = Members(objectSet, physicalIds, left.Id);
                List<string> rightMembers = Members(objectSet, physicalIds, right.Id);
                List<string> blockers = CrossingConstraints(leftMembers, rightMembers, forbidden);
                if (blockers.Count > 0)
                {
                    blockedMerges.Add(new BlockedIdentityMergeRecord(
                        assertion.Id,
                        leftMembers,
                        rightMembers,
                        blockers,
                        "A supported different-object constraint blocks this direct or transitive merge."));
                    continue;
                }
                objectSet.Union(left.Id, right.Id);
                acceptedMergeAssertionIds.Add(assertion.Id);
            }

            Dictionary<string, List<string>> membersByRoot = physicalIds
                .GroupBy(value => objectSet.Find(value), StringComparer.Ordinal)
                .ToDictionary(
                    group => group.Key,
                    group => group.OrderBy(value => value, StringComparer.Ordinal).ToList(),
                    StringComparer.Ordinal);
            var clusterIdByRoot = new Dictionary<string, string>(StringComparer.Ordinal);
            foreach (KeyValuePair<string, List<string>> group in membersByRoot)
            {
                clusterIdByRoot[group.Key] = "physical-object-cluster:" + Hash(group.Value);
            }

            List<ScheduleIdentityResolutionRecord> scheduleResolutions = ResolveScheduleRecords(
                representations,
                assertions,
                byId,
                objectSet,
                clusterIdByRoot,
                forbidden);
            var schedulesByCluster = scheduleResolutions
                .Where(value => value.Status == "resolved_to_single_physical_cluster")
                .GroupBy(value => value.ResolvedPhysicalClusterId, StringComparer.Ordinal)
                .ToDictionary(
                    group => group.Key,
                    group => group.Select(value => value.ScheduleRecordId).ToList(),
                    StringComparer.Ordinal);
            var scheduleAssertionsByCluster = scheduleResolutions
                .Where(value => value.Status == "resolved_to_single_physical_cluster")
                .GroupBy(value => value.ResolvedPhysicalClusterId, StringComparer.Ordinal)
                .ToDictionary(
                    group => group.Key,
                    group => group.SelectMany(value => value.SupportingAssertionIds).ToList(),
                    StringComparer.Ordinal);

            var physicalClusters = new List<ResolvedPhysicalObjectClusterRecord>();
            foreach (KeyValuePair<string, List<string>> group in membersByRoot
                .OrderBy(value => value.Key, StringComparer.Ordinal))
            {
                if (!config.IncludeSingletonPhysicalClusters && group.Value.Count == 1) { continue; }
                string clusterId = clusterIdByRoot[group.Key];
                List<string> scheduleIds;
                List<string> scheduleAssertionIds;
                schedulesByCluster.TryGetValue(clusterId, out scheduleIds);
                scheduleAssertionsByCluster.TryGetValue(clusterId, out scheduleAssertionIds);
                var mergeAssertions = assertions.Where(value =>
                    acceptedMergeAssertionIds.Contains(value.Id)
                    && group.Value.Contains(value.LeftRepresentationId)
                    && group.Value.Contains(value.RightRepresentationId))
                    .Select(value => value.Id)
                    .Concat(scheduleAssertionIds ?? Enumerable.Empty<string>());
                physicalClusters.Add(new ResolvedPhysicalObjectClusterRecord(
                    clusterId,
                    group.Value,
                    scheduleIds,
                    mergeAssertions));
            }

            List<IdentityCandidateGroupRecord> possibleGroups = BuildPossibleGroups(
                representations,
                assertions,
                byId,
                objectSet,
                membersByRoot,
                clusterIdByRoot,
                forbidden);
            List<IdentityTypeCandidateGroupRecord> typeGroups = BuildTypeGroups(
                representations,
                correspondence,
                assertions,
                byId);

            return new RepresentationIdentityResolutionDocument(
                regions.DrawingId,
                representations.OrderBy(value => value.Id, StringComparer.Ordinal),
                assertions,
                physicalClusters.OrderBy(value => value.Id, StringComparer.Ordinal),
                possibleGroups.OrderBy(value => value.Id, StringComparer.Ordinal),
                typeGroups.OrderBy(value => value.Id, StringComparer.Ordinal),
                blockedMerges.OrderBy(value => value.AssertionId, StringComparer.Ordinal),
                scheduleResolutions.OrderBy(value => value.ScheduleRecordId, StringComparer.Ordinal),
                diagnostics);
        }

        static List<ScheduleIdentityResolutionRecord> ResolveScheduleRecords(
            IEnumerable<IdentityRepresentationRecord> representations,
            IEnumerable<RepresentationIdentityAssertionRecord> assertions,
            IDictionary<string, IdentityRepresentationRecord> byId,
            DisjointSet objectSet,
            IDictionary<string, string> clusterIdByRoot,
            IDictionary<string, List<string>> forbidden)
        {
            var result = new List<ScheduleIdentityResolutionRecord>();
            foreach (IdentityRepresentationRecord schedule in representations
                .Where(value => value.IsSchedule)
                .OrderBy(value => value.Id, StringComparer.Ordinal))
            {
                var links = assertions.Where(value => value.IsMergeEligible
                    && ((value.LeftRepresentationId == schedule.Id
                            && byId[value.RightRepresentationId].IsPhysical)
                        || (value.RightRepresentationId == schedule.Id
                            && byId[value.LeftRepresentationId].IsPhysical)))
                    .ToList();
                var allowedLinks = links.Where(value =>
                {
                    string physicalId = value.LeftRepresentationId == schedule.Id
                        ? value.RightRepresentationId : value.LeftRepresentationId;
                    string root = objectSet.Find(physicalId);
                    return !objectSet.Values.Any(member =>
                        objectSet.Find(member) == root
                        && forbidden.ContainsKey(PairKey(schedule.Id, member)));
                }).ToList();
                List<string> clusterIds = allowedLinks.Select(value =>
                {
                    string physicalId = value.LeftRepresentationId == schedule.Id
                        ? value.RightRepresentationId : value.LeftRepresentationId;
                    return clusterIdByRoot[objectSet.Find(physicalId)];
                }).Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal).ToList();
                string status;
                string resolved = "";
                string message;
                if (clusterIds.Count == 1)
                {
                    status = "resolved_to_single_physical_cluster";
                    resolved = clusterIds[0];
                    message = "All supported schedule links resolve to one physical object cluster.";
                }
                else if (clusterIds.Count > 1)
                {
                    status = "conflicting_physical_targets";
                    message = "Supported schedule links resolve to multiple physical clusters; the record was not attached.";
                }
                else if (links.Count > 0)
                {
                    status = "blocked_by_different_object_constraint";
                    message = "All supported schedule links conflict with a hard different-object constraint.";
                }
                else
                {
                    status = "unlinked_schedule_record";
                    message = "A schedule record never forms a physical object cluster by itself.";
                }
                result.Add(new ScheduleIdentityResolutionRecord(
                    schedule.Id,
                    status,
                    resolved,
                    clusterIds,
                    allowedLinks.Select(value => value.Id),
                    message));
            }
            return result;
        }

        static List<IdentityCandidateGroupRecord> BuildPossibleGroups(
            IEnumerable<IdentityRepresentationRecord> representations,
            IEnumerable<RepresentationIdentityAssertionRecord> assertions,
            IDictionary<string, IdentityRepresentationRecord> byId,
            DisjointSet objectSet,
            IDictionary<string, List<string>> membersByRoot,
            IDictionary<string, string> clusterIdByRoot,
            IDictionary<string, List<string>> forbidden)
        {
            var possible = assertions.Where(value =>
                value.EdgeType == RepresentationIdentityEdgeTypes.SameObjectPossible
                && value.Status != "unsupported").ToList();
            var set = new DisjointSet();
            var assertionNodes = new Dictionary<string, string[]>(StringComparer.Ordinal);
            foreach (RepresentationIdentityAssertionRecord assertion in possible)
            {
                string leftNode = CandidateNode(assertion.LeftRepresentationId, byId, objectSet, clusterIdByRoot);
                string rightNode = CandidateNode(assertion.RightRepresentationId, byId, objectSet, clusterIdByRoot);
                if (string.IsNullOrEmpty(leftNode) || string.IsNullOrEmpty(rightNode) || leftNode == rightNode) { continue; }
                set.Add(leftNode);
                set.Add(rightNode);
                set.Union(leftNode, rightNode);
                assertionNodes[assertion.Id] = new[] { leftNode, rightNode };
            }
            var result = new List<IdentityCandidateGroupRecord>();
            foreach (IGrouping<string, string> group in set.Values
                .GroupBy(value => set.Find(value), StringComparer.Ordinal))
            {
                List<string> nodes = group.OrderBy(value => value, StringComparer.Ordinal).ToList();
                if (nodes.Count < 2) { continue; }
                var memberIds = new List<string>();
                var clusterIds = new List<string>();
                foreach (string node in nodes)
                {
                    string root = clusterIdByRoot.FirstOrDefault(value => value.Value == node).Key;
                    if (!string.IsNullOrEmpty(root))
                    {
                        clusterIds.Add(node);
                        memberIds.AddRange(membersByRoot[root]);
                    }
                    else
                    {
                        memberIds.Add(node.Substring("representation:".Length));
                    }
                }
                List<string> assertionIds = assertionNodes.Where(value =>
                    nodes.Contains(value.Value[0]) && nodes.Contains(value.Value[1]))
                    .Select(value => value.Key).ToList();
                List<string> conflicts = ConstraintsWithin(memberIds, forbidden);
                result.Add(new IdentityCandidateGroupRecord(
                    "same-object-possible-group:" + Hash(nodes),
                    memberIds,
                    clusterIds,
                    assertionIds,
                    conflicts));
            }
            return result;
        }

        static string CandidateNode(
            string representationId,
            IDictionary<string, IdentityRepresentationRecord> byId,
            DisjointSet objectSet,
            IDictionary<string, string> clusterIdByRoot)
        {
            IdentityRepresentationRecord representation;
            if (!byId.TryGetValue(representationId, out representation) || representation.IsTypeReference) { return ""; }
            if (representation.IsPhysical)
            {
                return clusterIdByRoot[objectSet.Find(representationId)];
            }
            return "representation:" + representationId;
        }

        static List<IdentityTypeCandidateGroupRecord> BuildTypeGroups(
            IEnumerable<IdentityRepresentationRecord> representations,
            RepresentationCorrespondenceDocument correspondence,
            IEnumerable<RepresentationIdentityAssertionRecord> assertions,
            IDictionary<string, IdentityRepresentationRecord> byId)
        {
            var set = new DisjointSet();
            foreach (IdentityRepresentationRecord representation in representations) { set.Add(representation.Id); }
            foreach (RepeatedRepresentationFamilyRecord family in correspondence.RepeatedFamilies)
            {
                List<string> ids = family.RegionIds.Where(byId.ContainsKey).ToList();
                for (int index = 1; index < ids.Count; index++) { set.Union(ids[0], ids[index]); }
            }
            foreach (RepresentationIdentityAssertionRecord assertion in assertions.Where(value =>
                value.Status == "supported"
                && (value.EdgeType == RepresentationIdentityEdgeTypes.SameTypeOnly
                    || value.EdgeType == RepresentationIdentityEdgeTypes.RepresentsType)))
            {
                set.Union(assertion.LeftRepresentationId, assertion.RightRepresentationId);
            }
            var result = new List<IdentityTypeCandidateGroupRecord>();
            foreach (IGrouping<string, string> group in set.Values
                .GroupBy(value => set.Find(value), StringComparer.Ordinal))
            {
                List<string> ids = group.OrderBy(value => value, StringComparer.Ordinal).ToList();
                if (ids.Count < 2) { continue; }
                List<string> assertionIds = assertions.Where(value =>
                    (value.EdgeType == RepresentationIdentityEdgeTypes.SameTypeOnly
                        || value.EdgeType == RepresentationIdentityEdgeTypes.RepresentsType)
                    && ids.Contains(value.LeftRepresentationId)
                    && ids.Contains(value.RightRepresentationId))
                    .Select(value => value.Id).ToList();
                result.Add(new IdentityTypeCandidateGroupRecord(
                    "type-candidate-group:" + Hash(ids),
                    ids,
                    ids.Select(value => byId[value].InvariantSignatureId),
                    assertionIds));
            }
            return result;
        }

        static Dictionary<string, List<string>> BuildForbiddenPairs(
            IEnumerable<RepresentationIdentityAssertionRecord> assertions,
            IDictionary<string, IdentityRepresentationRecord> byId)
        {
            var result = new Dictionary<string, List<string>>(StringComparer.Ordinal);
            foreach (RepresentationIdentityAssertionRecord assertion in assertions.Where(value =>
                value.EdgeType == RepresentationIdentityEdgeTypes.DifferentObjectProven
                && value.Status == "supported"))
            {
                if (!byId.ContainsKey(assertion.LeftRepresentationId)
                    || !byId.ContainsKey(assertion.RightRepresentationId)) { continue; }
                string key = PairKey(assertion.LeftRepresentationId, assertion.RightRepresentationId);
                List<string> ids;
                if (!result.TryGetValue(key, out ids))
                {
                    ids = new List<string>();
                    result[key] = ids;
                }
                ids.Add(assertion.Id);
            }
            return result;
        }

        static IEnumerable<RepresentationIdentityAssertionRecord> CollapseDuplicateAssertions(
            IEnumerable<RepresentationIdentityAssertionRecord> values,
            IList<RepresentationIdentityDiagnosticRecord> diagnostics)
        {
            var result = new List<RepresentationIdentityAssertionRecord>();
            foreach (IGrouping<string, RepresentationIdentityAssertionRecord> group in values
                .GroupBy(value => value.Id, StringComparer.Ordinal)
                .OrderBy(value => value.Key, StringComparer.Ordinal))
            {
                List<RepresentationIdentityAssertionRecord> assertions = group.ToList();
                RepresentationIdentityAssertionRecord selected = assertions
                    .OrderBy(value => StatusRank(value.Status))
                    .ThenBy(value => value.EvidenceGrade, StringComparer.Ordinal)
                    .ThenBy(value => value.Message, StringComparer.Ordinal)
                    .First();
                if (assertions.Select(value => value.Status)
                    .Distinct(StringComparer.Ordinal).Count() > 1)
                {
                    diagnostics.Add(new RepresentationIdentityDiagnosticRecord(
                        "CONFLICTING_DUPLICATE_IDENTITY_ASSERTION",
                        "unsupported",
                        group.Key,
                        "Duplicate assertions with the same stable ID disagree on status; the most conservative status was retained."));
                }
                result.Add(selected);
            }
            return result;
        }

        static int StatusRank(string value)
        {
            if (value == "unsupported") { return 0; }
            if (value == "ambiguous") { return 1; }
            return 2;
        }

        static List<string> Members(DisjointSet set, IEnumerable<string> values, string member)
        {
            string root = set.Find(member);
            return values.Where(value => set.Find(value) == root)
                .OrderBy(value => value, StringComparer.Ordinal).ToList();
        }

        static List<string> CrossingConstraints(
            IEnumerable<string> left,
            IEnumerable<string> right,
            IDictionary<string, List<string>> forbidden)
        {
            var result = new List<string>();
            foreach (string leftId in left)
            {
                foreach (string rightId in right)
                {
                    List<string> ids;
                    if (forbidden.TryGetValue(PairKey(leftId, rightId), out ids)) { result.AddRange(ids); }
                }
            }
            return result.Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal).ToList();
        }

        static List<string> ConstraintsWithin(
            IEnumerable<string> members,
            IDictionary<string, List<string>> forbidden)
        {
            List<string> values = members.Distinct(StringComparer.Ordinal)
                .OrderBy(value => value, StringComparer.Ordinal).ToList();
            var result = new List<string>();
            for (int left = 0; left < values.Count; left++)
            {
                for (int right = left + 1; right < values.Count; right++)
                {
                    List<string> ids;
                    if (forbidden.TryGetValue(PairKey(values[left], values[right]), out ids))
                    {
                        result.AddRange(ids);
                    }
                }
            }
            return result.Distinct(StringComparer.Ordinal).OrderBy(value => value, StringComparer.Ordinal).ToList();
        }

        static RepresentationIdentityAssertionRecord CreateAssertion(
            string left,
            string right,
            string edgeType,
            string status,
            string evidenceGrade,
            string origin,
            string sourceKind,
            IEnumerable<string> sourceIds,
            string message,
            double score)
        {
            string first = string.Compare(left, right, StringComparison.Ordinal) <= 0 ? left : right;
            string second = first == left ? right : left;
            List<string> sources = IdentityMaps.SortedUnique(sourceIds);
            string id = "identity-assertion:" + Hash(new[]
            {
                first,
                second,
                edgeType,
                origin,
                sourceKind,
                string.Join("|", sources)
            });
            return new RepresentationIdentityAssertionRecord(
                id, first, second, edgeType, status, evidenceGrade,
                origin, sourceKind, sources, message, score);
        }

        static bool IsAllowedEdgeType(string value)
        {
            return value == RepresentationIdentityEdgeTypes.SameObjectSupported
                || value == RepresentationIdentityEdgeTypes.SameObjectPossible
                || value == RepresentationIdentityEdgeTypes.DifferentObjectProven
                || value == RepresentationIdentityEdgeTypes.SameTypeOnly
                || value == RepresentationIdentityEdgeTypes.RepresentsType;
        }

        static bool IsIndependentIdentitySource(string value)
        {
            string normalized = (value ?? "").Trim().ToLowerInvariant();
            return normalized != "representation_correspondence"
                && normalized != "geometry_repetition"
                && normalized != "topology_similarity"
                && normalized != "projection_alignment"
                && normalized != "orthographic_projection";
        }

        static string NormalizeStatus(string value)
        {
            string normalized = (value ?? "").Trim().ToLowerInvariant();
            if (normalized == "supported" || normalized == "ambiguous" || normalized == "unsupported")
            {
                return normalized;
            }
            return "unsupported";
        }

        static string PairKey(string left, string right)
        {
            return string.Compare(left, right, StringComparison.Ordinal) <= 0
                ? left + "\u001f" + right
                : right + "\u001f" + left;
        }

        static void ValidateConfig(RepresentationIdentityConfig config)
        {
            if (config.MaximumRepresentationCount <= 0)
            {
                throw new ArgumentOutOfRangeException("config.MaximumRepresentationCount");
            }
            if (config.MaximumAssertionCount <= 0)
            {
                throw new ArgumentOutOfRangeException("config.MaximumAssertionCount");
            }
        }

        static string Hash(IEnumerable<string> values)
        {
            string text = string.Join("\u001f", values ?? Enumerable.Empty<string>());
            byte[] bytes = Encoding.UTF8.GetBytes(text);
            using (SHA256 sha = SHA256.Create())
            {
                return BitConverter.ToString(sha.ComputeHash(bytes))
                    .Replace("-", "").Substring(0, 20).ToLowerInvariant();
            }
        }
    }

    static class IdentityMaps
    {
        public static Dictionary<string, object> Map(params object[] values)
        {
            var result = new Dictionary<string, object>(StringComparer.Ordinal);
            for (int index = 0; index + 1 < values.Length; index += 2)
            {
                result[(string)values[index]] = values[index + 1];
            }
            return result;
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
    }
}
