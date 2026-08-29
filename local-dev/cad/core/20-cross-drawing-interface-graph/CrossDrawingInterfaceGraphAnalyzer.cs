using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;

namespace Shb.Cad.Core
{
    public static class CrossDrawingInterfaceGraphAnalyzer
    {
        public static CrossDrawingInterfaceGraphDocument Analyze(
            IEnumerable<CrossDrawingDrawingObservation> drawings)
        {
            return Analyze(drawings, new CrossDrawingInterfaceGraphConfig());
        }

        public static CrossDrawingInterfaceGraphDocument Analyze(
            IEnumerable<CrossDrawingDrawingObservation> drawingValues,
            CrossDrawingInterfaceGraphConfig config)
        {
            config = config ?? new CrossDrawingInterfaceGraphConfig();
            var diagnostics = new List<CrossDrawingDiagnosticRecord>();
            var audits = new List<CrossDrawingAuditRecord>();
            var relations = new List<CrossDrawingRelationRecord>();
            var identities = new List<CrossDrawingIdentityAssertionRecord>();
            var comparisons = new List<CrossDrawingInterfaceComparisonRecord>();
            bool truncated = false;
            long candidateComparisonCount = 0;

            List<CrossDrawingDrawingObservation> drawings = drawingValues == null
                ? new List<CrossDrawingDrawingObservation>()
                : drawingValues.Where(value => value != null)
                    .OrderBy(value => value.SnapshotId, StringComparer.Ordinal)
                    .ThenBy(value => value.DrawingKey, StringComparer.Ordinal)
                    .ToList();
            if (drawings.Count > Math.Max(1, config.MaximumDrawingCount))
            {
                drawings = drawings.Take(Math.Max(1, config.MaximumDrawingCount)).ToList();
                truncated = true;
                diagnostics.Add(new CrossDrawingDiagnosticRecord(
                    "PROJECT_DRAWING_LIMIT_REACHED",
                    "unsupported",
                    "",
                    "Only the configured maximum drawing observations were processed; omitted drawings are unknown."));
            }

            var duplicateSnapshots = drawings
                .Where(value => !string.IsNullOrWhiteSpace(value.SnapshotId))
                .GroupBy(value => value.SnapshotId, StringComparer.Ordinal)
                .Where(group => group.Count() > 1)
                .ToList();
            foreach (IGrouping<string, CrossDrawingDrawingObservation> group in duplicateSnapshots)
            {
                diagnostics.Add(new CrossDrawingDiagnosticRecord(
                    "DUPLICATE_SNAPSHOT_ID",
                    "ambiguous",
                    group.Key,
                    "More than one drawing observation carries the same snapshot id; all copies remain visible."));
            }

            int referenceCount = drawings.Sum(value => value.ComponentReferences.Count);
            int interfaceCount = drawings.Sum(value => value.Interfaces.Count);
            bool referenceBudgetAvailable = referenceCount <= Math.Max(1, config.MaximumReferenceCount);
            bool interfaceBudgetAvailable = interfaceCount <= Math.Max(1, config.MaximumInterfaceCount);
            if (!referenceBudgetAvailable)
            {
                truncated = true;
                diagnostics.Add(new CrossDrawingDiagnosticRecord(
                    "PROJECT_REFERENCE_LIMIT_REACHED",
                    "unsupported",
                    "",
                    "Reference resolution was stopped because the configured project reference limit was exceeded."));
            }
            if (!interfaceBudgetAvailable)
            {
                truncated = true;
                diagnostics.Add(new CrossDrawingDiagnosticRecord(
                    "PROJECT_INTERFACE_LIMIT_REACHED",
                    "unsupported",
                    "",
                    "Interface comparison was stopped because the configured project interface limit was exceeded."));
            }

            Dictionary<string, List<CrossDrawingDrawingObservation>> titleIndex = drawings
                .Where(value => !string.IsNullOrEmpty(value.NormalizedDrawingNumber))
                .GroupBy(value => value.NormalizedDrawingNumber, StringComparer.Ordinal)
                .ToDictionary(
                    group => group.Key,
                    group => group.OrderBy(value => value.NormalizedSheet, StringComparer.Ordinal)
                        .ThenBy(value => value.Revision, StringComparer.Ordinal)
                        .ThenBy(value => value.SnapshotId, StringComparer.Ordinal).ToList(),
                    StringComparer.Ordinal);

            AddDrawingIdentityAudits(drawings, titleIndex, audits, diagnostics);
            if (referenceBudgetAvailable)
            {
                var missingByCode = new Dictionary<string, List<ReferenceContext>>(StringComparer.Ordinal);
                var resolvedLinks = new List<ResolvedReferenceLink>();
                foreach (CrossDrawingDrawingObservation drawing in drawings)
                {
                    foreach (CrossDrawingComponentReferenceObservation reference
                        in drawing.ComponentReferences.OrderBy(value => value.Id, StringComparer.Ordinal))
                    {
                        string authoredStatus = reference.IsStructuredAuthoredReference
                            ? CrossDrawingSemanticStatus.Supported
                            : CrossDrawingSemanticStatus.Possible;
                        relations.Add(new CrossDrawingRelationRecord(
                            "component_ref",
                            drawing.NodeId,
                            reference.Id,
                            authoredStatus,
                            "source_declared",
                            reference.EvidenceKind,
                            new[] { "authored_reference_occurs_in_source_drawing" },
                            reference.SourceIds));

                        TargetResolution target = ResolveTargets(reference, titleIndex);
                        if (target.Candidates.Count == 0)
                        {
                            string placeholder = "drawing-key:" + (string.IsNullOrEmpty(
                                reference.NormalizedReferenceCode)
                                ? CrossDrawingMaps.Hash(reference.Id)
                                : reference.NormalizedReferenceCode);
                            relations.Add(new CrossDrawingRelationRecord(
                                "drawing_ref",
                                reference.Id,
                                placeholder,
                                CrossDrawingSemanticStatus.Unresolved,
                                "unknown",
                                target.Resolution,
                                new[] { "no_exact_title_identity_in_supplied_drawing_set" },
                                reference.SourceIds));
                            identities.Add(new CrossDrawingIdentityAssertionRecord(
                                "component_to_drawing",
                                new[] { reference.Id, placeholder },
                                new[] { drawing.SnapshotId },
                                CrossDrawingSemanticStatus.Unresolved,
                                "unknown",
                                new string[0],
                                new string[0],
                                new[] { placeholder }));
                            if (reference.LooksLikeDrawingCode)
                            {
                                List<ReferenceContext> contexts;
                                if (!missingByCode.TryGetValue(
                                    reference.NormalizedReferenceCode, out contexts))
                                {
                                    contexts = new List<ReferenceContext>();
                                    missingByCode[reference.NormalizedReferenceCode] = contexts;
                                }
                                contexts.Add(new ReferenceContext(drawing, reference));
                            }
                            continue;
                        }

                        string relationStatus = target.Ambiguous
                            ? CrossDrawingSemanticStatus.Possible
                            : authoredStatus;
                        string evidenceGrade = relationStatus == CrossDrawingSemanticStatus.Supported
                            ? "multi_evidence_supported"
                            : "deterministic_rule_derived";
                        foreach (CrossDrawingDrawingObservation candidate in target.Candidates)
                        {
                            relations.Add(new CrossDrawingRelationRecord(
                                "drawing_ref",
                                reference.Id,
                                candidate.NodeId,
                                relationStatus,
                                evidenceGrade,
                                target.Resolution,
                                new[]
                                {
                                    "reference_code:" + reference.ReferenceCode,
                                    "title_drawing_number:" + candidate.DrawingNumber,
                                    target.MultiSheetSet
                                        ? "distinct_authored_sheets_form_one_drawing_set"
                                        : "exact_normalized_code_match"
                                },
                                reference.SourceIds.Concat(new[] { candidate.SnapshotId })));
                        }
                        identities.Add(new CrossDrawingIdentityAssertionRecord(
                            "component_to_drawing",
                            new[] { reference.Id }.Concat(target.Candidates.Select(value => value.NodeId)),
                            new[] { drawing.SnapshotId }.Concat(target.Candidates.Select(value => value.SnapshotId)),
                            relationStatus,
                            evidenceGrade,
                            new[]
                            {
                                "authored_reference_code_matches_authored_title_identity",
                                target.MultiSheetSet
                                    ? "target_is_a_nonduplicated_multi_sheet_set"
                                    : "target_title_identity_is_unique"
                            },
                            target.Ambiguous
                                ? new[] { "target_sheet_or_version_not_uniquely_resolved" }
                                : new string[0],
                            target.Ambiguous
                                ? target.Candidates.Select(value => value.NodeId)
                                : new string[0]));
                        resolvedLinks.Add(new ResolvedReferenceLink(
                            drawing, reference, target.Candidates, relationStatus, target.Resolution));
                    }
                }
                AddMissingReferenceAudits(missingByCode, audits);

                if (interfaceBudgetAvailable)
                {
                    CompareInterfaces(
                        resolvedLinks,
                        config,
                        relations,
                        identities,
                        comparisons,
                        audits,
                        diagnostics,
                        ref candidateComparisonCount,
                        ref truncated);
                }
            }

            return new CrossDrawingInterfaceGraphDocument(
                drawings,
                relations,
                identities,
                comparisons,
                audits,
                diagnostics,
                candidateComparisonCount,
                truncated);
        }

        static void AddDrawingIdentityAudits(
            IList<CrossDrawingDrawingObservation> drawings,
            IDictionary<string, List<CrossDrawingDrawingObservation>> titleIndex,
            IList<CrossDrawingAuditRecord> audits,
            IList<CrossDrawingDiagnosticRecord> diagnostics)
        {
            foreach (CrossDrawingDrawingObservation drawing in drawings.Where(value =>
                string.IsNullOrEmpty(value.NormalizedDrawingNumber)))
            {
                diagnostics.Add(new CrossDrawingDiagnosticRecord(
                    "DRAWING_NUMBER_UNRESOLVED",
                    "ambiguous",
                    drawing.SnapshotId,
                    "The drawing observation has no authored drawing number and cannot be an exact reference target."));
            }
            foreach (KeyValuePair<string, List<CrossDrawingDrawingObservation>> pair in titleIndex)
            {
                foreach (IGrouping<string, CrossDrawingDrawingObservation> sheetGroup in pair.Value
                    .GroupBy(value => value.NormalizedSheet, StringComparer.Ordinal)
                    .Where(group => group.Count() > 1))
                {
                    List<CrossDrawingDrawingObservation> copies = sheetGroup.ToList();
                    bool revisionConflict = copies.Select(value =>
                            CrossDrawingMaps.NormalizeIdentity(value.Revision))
                        .Where(value => !string.IsNullOrEmpty(value))
                        .Distinct(StringComparer.Ordinal).Count() > 1;
                    audits.Add(new CrossDrawingAuditRecord(
                        revisionConflict
                            ? "MULTIPLE_REVISIONS_FOR_DRAWING_SHEET"
                            : "DUPLICATE_DRAWING_SHEET_IN_PROJECT_SET",
                        "open",
                        "review",
                        CrossDrawingSemanticStatus.Possible,
                        "The supplied set contains multiple snapshots for drawing number "
                            + copies[0].DrawingNumber + " sheet " + copies[0].Sheet
                            + (revisionConflict
                                ? " with different authored revisions; a reference without revision cannot choose one."
                                : "; they may be duplicate files or versions without an authored revision."),
                        copies.Select(value => value.NodeId)));
                }
            }
        }

        static TargetResolution ResolveTargets(
            CrossDrawingComponentReferenceObservation reference,
            IDictionary<string, List<CrossDrawingDrawingObservation>> titleIndex)
        {
            List<CrossDrawingDrawingObservation> candidates;
            if (string.IsNullOrEmpty(reference.NormalizedReferenceCode)
                || !titleIndex.TryGetValue(reference.NormalizedReferenceCode, out candidates))
            {
                return new TargetResolution(
                    new List<CrossDrawingDrawingObservation>(),
                    false,
                    false,
                    "not_present_in_supplied_drawing_set");
            }
            IEnumerable<CrossDrawingDrawingObservation> filtered = candidates;
            string sheet = CrossDrawingMaps.NormalizeIdentity(reference.ReferencedSheet);
            if (!string.IsNullOrEmpty(sheet))
            {
                filtered = filtered.Where(value => value.NormalizedSheet == sheet);
            }
            string revision = CrossDrawingMaps.NormalizeIdentity(reference.ReferencedRevision);
            if (!string.IsNullOrEmpty(revision))
            {
                filtered = filtered.Where(value =>
                    CrossDrawingMaps.NormalizeIdentity(value.Revision) == revision);
            }
            List<CrossDrawingDrawingObservation> result = filtered.ToList();
            if (result.Count == 0)
            {
                return new TargetResolution(
                    result,
                    false,
                    false,
                    "title_number_exists_but_sheet_or_revision_qualifier_does_not_match");
            }
            bool duplicateSheet = result.GroupBy(value => value.NormalizedSheet, StringComparer.Ordinal)
                .Any(group => group.Count() > 1);
            bool multiSheet = result.Count > 1 && !duplicateSheet
                && string.IsNullOrEmpty(sheet);
            bool ambiguous = duplicateSheet;
            string resolution = ambiguous
                ? "duplicate_sheet_or_unresolved_version_candidates"
                : multiSheet
                    ? "exact_authored_multi_sheet_drawing_set"
                    : "exact_authored_title_identity";
            return new TargetResolution(result, ambiguous, multiSheet, resolution);
        }

        static void AddMissingReferenceAudits(
            IDictionary<string, List<ReferenceContext>> missingByCode,
            IList<CrossDrawingAuditRecord> audits)
        {
            foreach (KeyValuePair<string, List<ReferenceContext>> pair in missingByCode
                .OrderBy(value => value.Key, StringComparer.Ordinal))
            {
                ReferenceContext first = pair.Value[0];
                audits.Add(new CrossDrawingAuditRecord(
                    "REFERENCED_DRAWING_NOT_IN_SUPPLIED_SET_CANDIDATE",
                    "open",
                    "inventory",
                    CrossDrawingSemanticStatus.Unresolved,
                    "Reference code " + first.Reference.ReferenceCode + " occurs in "
                        + pair.Value.Select(value => value.Drawing.DrawingNumber)
                            .Distinct(StringComparer.Ordinal).Count().ToString(CultureInfo.InvariantCulture)
                        + " supplied source drawing(s), but no exact title identity is present in this input set. "
                        + "This does not prove that the enterprise file is missing.",
                    pair.Value.SelectMany(value => new[]
                    {
                        value.Drawing.NodeId,
                        value.Reference.Id
                    })));
            }
        }

        static void CompareInterfaces(
            IList<ResolvedReferenceLink> links,
            CrossDrawingInterfaceGraphConfig config,
            IList<CrossDrawingRelationRecord> relations,
            IList<CrossDrawingIdentityAssertionRecord> identities,
            IList<CrossDrawingInterfaceComparisonRecord> comparisons,
            IList<CrossDrawingAuditRecord> audits,
            IList<CrossDrawingDiagnosticRecord> diagnostics,
            ref long candidateComparisonCount,
            ref bool truncated)
        {
            var processed = new HashSet<string>(StringComparer.Ordinal);
            foreach (ResolvedReferenceLink link in links)
            {
                InterfaceContext context = ResolveInterfaceContext(
                    link.SourceDrawing, link.Reference, config);
                if (context.Interfaces.Count == 0)
                {
                    diagnostics.Add(new CrossDrawingDiagnosticRecord(
                        "REFERENCE_INTERFACE_CONTEXT_UNRESOLVED",
                        "ambiguous",
                        link.Reference.Id,
                        "The drawing reference is resolved, but no explicit or pointer-near source interface can be selected conservatively."));
                    continue;
                }
                foreach (CrossDrawingDrawingObservation targetDrawing in link.TargetDrawings)
                {
                    if (targetDrawing.SnapshotId == link.SourceDrawing.SnapshotId) { continue; }
                    foreach (CrossDrawingInterfaceObservation sourceInterface in context.Interfaces)
                    {
                        string processedKey = link.Reference.Id + "|" + sourceInterface.Id
                            + "|" + targetDrawing.NodeId;
                        if (!processed.Add(processedKey)) { continue; }
                        List<CrossDrawingInterfaceObservation> familyCandidates = targetDrawing.Interfaces
                            .Where(value => SameFamily(sourceInterface, value))
                            .OrderBy(value => value.Id, StringComparer.Ordinal)
                            .ToList();
                        if (familyCandidates.Count == 0)
                        {
                            diagnostics.Add(new CrossDrawingDiagnosticRecord(
                                "TARGET_INTERFACE_FAMILY_NOT_OBSERVED",
                                "ambiguous",
                                sourceInterface.Id,
                                "No same-family interface candidate was observed in target "
                                    + targetDrawing.DrawingKey
                                    + "; upstream extraction incompleteness is not treated as absence."));
                            continue;
                        }
                        var evaluated = new List<InterfaceEvaluation>();
                        foreach (CrossDrawingInterfaceObservation candidate in familyCandidates)
                        {
                            if (candidateComparisonCount >= Math.Max(
                                1, config.MaximumCandidateComparisonCount))
                            {
                                truncated = true;
                                diagnostics.Add(new CrossDrawingDiagnosticRecord(
                                    "INTERFACE_COMPARISON_BUDGET_REACHED",
                                    "unsupported",
                                    link.Reference.Id,
                                    "Candidate comparison budget was reached; remaining identities were not guessed."));
                                return;
                            }
                            candidateComparisonCount++;
                            evaluated.Add(EvaluateInterface(
                                sourceInterface,
                                candidate,
                                link.SourceDrawing,
                                targetDrawing,
                                config));
                        }
                        AddBestInterfaceResult(
                            link,
                            context,
                            sourceInterface,
                            targetDrawing,
                            evaluated,
                            config,
                            relations,
                            identities,
                            comparisons,
                            audits);
                    }
                }
            }
        }

        static InterfaceContext ResolveInterfaceContext(
            CrossDrawingDrawingObservation drawing,
            CrossDrawingComponentReferenceObservation reference,
            CrossDrawingInterfaceGraphConfig config)
        {
            var direct = new List<CrossDrawingInterfaceObservation>();
            foreach (string id in reference.AssociatedInterfaceIds)
            {
                direct.AddRange(drawing.Interfaces.Where(value =>
                    value.Id == id || value.SourceElementId == id || value.SourceIds.Contains(id)));
            }
            direct = direct.Distinct().OrderBy(value => value.Id, StringComparer.Ordinal).ToList();
            if (direct.Count > 0)
            {
                return new InterfaceContext(
                    direct,
                    reference.AssociationStatus,
                    "explicit_interface_association");
            }
            if (!reference.HasPointer)
            {
                return new InterfaceContext(
                    new List<CrossDrawingInterfaceObservation>(),
                    CrossDrawingSemanticStatus.Unresolved,
                    "no_interface_context");
            }
            List<CrossDrawingInterfaceObservation> candidates = drawing.Interfaces
                .Where(value => value.Domain == "interface_feature" && value.HasBounds)
                .ToList();
            if (candidates.Count == 0)
            {
                return new InterfaceContext(
                    new List<CrossDrawingInterfaceObservation>(),
                    CrossDrawingSemanticStatus.Unresolved,
                    "no_bounded_interface_feature");
            }
            double minX = candidates.Min(value => value.MinX);
            double minY = candidates.Min(value => value.MinY);
            double maxX = candidates.Max(value => value.MaxX);
            double maxY = candidates.Max(value => value.MaxY);
            double diagonal = Math.Sqrt(
                (maxX - minX) * (maxX - minX) + (maxY - minY) * (maxY - minY));
            double maximumDistance = Math.Max(
                config.MinimumReferencePointerDistance,
                diagonal * config.ReferencePointerDistanceRatio);
            var distances = candidates.Select(value => new InterfaceDistance(
                    value,
                    DistanceToBounds(reference.PointerX, reference.PointerY, value)))
                .Where(value => value.Distance <= maximumDistance)
                .OrderBy(value => value.Distance)
                .ThenBy(value => BoundsArea(value.Interface))
                .ThenBy(value => value.Interface.Id, StringComparer.Ordinal)
                .ToList();
            if (distances.Count == 0)
            {
                return new InterfaceContext(
                    new List<CrossDrawingInterfaceObservation>(),
                    CrossDrawingSemanticStatus.Unresolved,
                    "pointer_has_no_near_interface_feature");
            }
            double bestDistance = distances[0].Distance;
            double distanceTie = Math.Max(config.AbsoluteMetricTolerance,
                maximumDistance * config.CandidateTieTolerance);
            List<CrossDrawingInterfaceObservation> best = distances
                .Where(value => value.Distance <= bestDistance + distanceTie)
                .Select(value => value.Interface)
                .Take(Math.Max(1, config.MaximumPointerInterfaceCandidates) + 1)
                .ToList();
            if (best.Count > Math.Max(1, config.MaximumPointerInterfaceCandidates))
            {
                return new InterfaceContext(
                    new List<CrossDrawingInterfaceObservation>(),
                    CrossDrawingSemanticStatus.Unresolved,
                    "pointer_near_too_many_nested_interface_features");
            }
            return new InterfaceContext(
                best,
                CrossDrawingSemanticStatus.Possible,
                best.Count == 1
                    ? "leader_pointer_nearest_interface_candidate"
                    : "leader_pointer_tied_nested_interface_candidates");
        }

        static void AddBestInterfaceResult(
            ResolvedReferenceLink link,
            InterfaceContext context,
            CrossDrawingInterfaceObservation sourceInterface,
            CrossDrawingDrawingObservation targetDrawing,
            IList<InterfaceEvaluation> evaluated,
            CrossDrawingInterfaceGraphConfig config,
            IList<CrossDrawingRelationRecord> relations,
            IList<CrossDrawingIdentityAssertionRecord> identities,
            IList<CrossDrawingInterfaceComparisonRecord> comparisons,
            IList<CrossDrawingAuditRecord> audits)
        {
            List<InterfaceEvaluation> ordered = evaluated
                .OrderByDescending(value => value.Score)
                .ThenBy(value => value.Target.Id, StringComparer.Ordinal)
                .ToList();
            InterfaceEvaluation best = ordered[0];
            List<InterfaceEvaluation> ties = ordered.Where(value =>
                Math.Abs(value.Score - best.Score) <= config.CandidateTieTolerance).ToList();
            bool uniqueBest = ties.Count == 1;
            bool hardConflict = uniqueBest && best.HardConflict;
            string status;
            string resolution;
            if (hardConflict
                && link.Status == CrossDrawingSemanticStatus.Supported
                && context.Status == CrossDrawingSemanticStatus.Supported)
            {
                status = CrossDrawingSemanticStatus.Conflicted;
                resolution = "unique_same_family_target_has_proven_metric_conflict";
            }
            else if (uniqueBest && best.Compatible
                && best.Score >= config.SupportedInterfaceScore
                && best.SupportingMetricCount >= 2
                && link.Status == CrossDrawingSemanticStatus.Supported
                && context.Status == CrossDrawingSemanticStatus.Supported)
            {
                status = CrossDrawingSemanticStatus.Supported;
                resolution = "unique_reference_scoped_compatible_interface_signature";
            }
            else
            {
                status = CrossDrawingSemanticStatus.Possible;
                resolution = !uniqueBest
                    ? "multiple_equal_interface_candidates"
                    : hardConflict
                        ? "metric_conflict_not_promoted_without_supported_interface_context"
                        : best.Compatible
                            ? "compatible_geometry_candidate_without_complete_identity_support"
                            : "same_family_geometry_difference_candidate";
            }

            var comparison = new CrossDrawingInterfaceComparisonRecord(
                link.Reference.Id,
                link.SourceDrawing.NodeId,
                targetDrawing.NodeId,
                sourceInterface.Id,
                best.Target.Id,
                status,
                best.Score,
                resolution,
                best.Metrics,
                best.Support.Concat(new[] { context.Resolution, link.Resolution }),
                best.Conflicts,
                ties.Skip(1).Select(value => value.Target.Id),
                DirectionDelta(sourceInterface, best.Target));
            comparisons.Add(comparison);
            string evidenceGrade = status == CrossDrawingSemanticStatus.Supported
                ? "multi_evidence_supported"
                : status == CrossDrawingSemanticStatus.Conflicted
                    ? "conflicted"
                    : "deterministic_rule_derived";
            relations.Add(new CrossDrawingRelationRecord(
                "interface_ref",
                sourceInterface.Id,
                best.Target.Id,
                status,
                evidenceGrade,
                resolution,
                comparison.Support.Concat(comparison.Conflicts),
                sourceInterface.SourceIds.Concat(best.Target.SourceIds)));
            identities.Add(new CrossDrawingIdentityAssertionRecord(
                "interface_to_interface",
                new[] { sourceInterface.Id, best.Target.Id },
                new[] { link.SourceDrawing.SnapshotId, targetDrawing.SnapshotId },
                status,
                evidenceGrade,
                comparison.Support,
                comparison.Conflicts,
                status == CrossDrawingSemanticStatus.Possible
                    ? ties.Select(value => value.Target.Id)
                    : new string[0]));
            if (status == CrossDrawingSemanticStatus.Conflicted)
            {
                audits.Add(new CrossDrawingAuditRecord(
                    "CROSS_DRAWING_INTERFACE_METRIC_CONFLICT_CANDIDATE",
                    "open",
                    "review",
                    CrossDrawingSemanticStatus.Conflicted,
                    "A supported drawing reference and explicit interface context lead to one target interface, but comparable authored/unit-proven metrics disagree.",
                    new[] { link.Reference.Id, sourceInterface.Id, best.Target.Id }));
            }
            else if (!best.Compatible && best.Conflicts.Count > 0)
            {
                audits.Add(new CrossDrawingAuditRecord(
                    "CROSS_DRAWING_INTERFACE_GEOMETRY_DIFFERENCE_CANDIDATE",
                    "open",
                    "review",
                    CrossDrawingSemanticStatus.Possible,
                    "Same-family interface geometry differs, but scale or exact interface identity is not fully proven; review before treating it as a conflict.",
                    new[] { link.Reference.Id, sourceInterface.Id, best.Target.Id }));
            }
        }

        static InterfaceEvaluation EvaluateInterface(
            CrossDrawingInterfaceObservation source,
            CrossDrawingInterfaceObservation target,
            CrossDrawingDrawingObservation sourceDrawing,
            CrossDrawingDrawingObservation targetDrawing,
            CrossDrawingInterfaceGraphConfig config)
        {
            var metrics = new List<CrossDrawingMetricComparisonRecord>();
            var support = new List<string>();
            var conflicts = new List<string>();
            bool hardConflict = false;
            int supportingMetricCount = 0;
            double scoreSum = 0;
            int scoreCount = 0;

            foreach (MetricPair pair in GeometryMetricPairs(source, target))
            {
                double difference = Math.Abs(pair.Source - pair.Target);
                double allowed = AllowedDifference(pair.Source, pair.Target, config);
                bool within = difference <= allowed;
                bool comparableScale = sourceDrawing.ComparableGeometryScaleProven
                    && targetDrawing.ComparableGeometryScaleProven
                    && !string.IsNullOrEmpty(sourceDrawing.UnitName)
                    && string.Equals(
                        sourceDrawing.UnitName,
                        targetDrawing.UnitName,
                        StringComparison.OrdinalIgnoreCase);
                string metricStatus = within
                    ? CrossDrawingSemanticStatus.Supported
                    : comparableScale
                        ? CrossDrawingSemanticStatus.Conflicted
                        : CrossDrawingSemanticStatus.Possible;
                metrics.Add(new CrossDrawingMetricComparisonRecord(
                    pair.Name,
                    pair.Source,
                    pair.Target,
                    difference,
                    allowed,
                    comparableScale
                        ? "unit_proven_world_geometry"
                        : "drawing_world_geometry_with_unverified_cross_file_scale",
                    metricStatus));
                double denominator = Math.Max(
                    Math.Max(Math.Abs(pair.Source), Math.Abs(pair.Target)),
                    config.AbsoluteMetricTolerance);
                scoreSum += Math.Max(0, 1.0 - difference / denominator);
                scoreCount++;
                if (within)
                {
                    supportingMetricCount++;
                    support.Add("within_tolerance:" + pair.Name);
                }
                else
                {
                    conflicts.Add((comparableScale
                        ? "proven_metric_difference:"
                        : "unverified_scale_geometry_difference:") + pair.Name);
                    if (comparableScale) { hardConflict = true; }
                }
            }

            foreach (BoundDimensionPair pair in BoundDimensionPairs(source, target))
            {
                double difference = Math.Abs(pair.Source - pair.Target);
                double allowed = AllowedDifference(pair.Source, pair.Target, config);
                bool within = difference <= allowed;
                metrics.Add(new CrossDrawingMetricComparisonRecord(
                    pair.Name,
                    pair.Source,
                    pair.Target,
                    difference,
                    allowed,
                    "uniquely_bound_authored_dimension",
                    within
                        ? CrossDrawingSemanticStatus.Supported
                        : CrossDrawingSemanticStatus.Conflicted));
                double denominator = Math.Max(
                    Math.Max(Math.Abs(pair.Source), Math.Abs(pair.Target)),
                    config.AbsoluteMetricTolerance);
                scoreSum += Math.Max(0, 1.0 - difference / denominator);
                scoreCount++;
                if (within)
                {
                    supportingMetricCount++;
                    support.Add("authored_dimension_within_tolerance:" + pair.Name);
                }
                else
                {
                    conflicts.Add("authored_dimension_conflict:" + pair.Name);
                    hardConflict = true;
                }
            }

            if (!string.IsNullOrEmpty(source.GeometrySignature)
                && source.GeometrySignature == target.GeometrySignature)
            {
                support.Add("exact_geometry_signature");
                scoreSum += 1;
                scoreCount++;
                supportingMetricCount++;
            }
            double score = scoreCount == 0 ? 0 : scoreSum / scoreCount;
            bool compatible = !hardConflict && (score >= 0.65 || supportingMetricCount >= 2);
            return new InterfaceEvaluation(
                target,
                score,
                supportingMetricCount,
                compatible,
                hardConflict,
                metrics,
                support,
                conflicts);
        }

        static IEnumerable<MetricPair> GeometryMetricPairs(
            CrossDrawingInterfaceObservation source,
            CrossDrawingInterfaceObservation target)
        {
            if (source.Domain == "interface_feature")
            {
                double sourceWidth;
                double sourceHeight;
                double targetWidth;
                double targetHeight;
                if (source.TryMetric("oriented_width", out sourceWidth)
                    && source.TryMetric("oriented_height", out sourceHeight)
                    && target.TryMetric("oriented_width", out targetWidth)
                    && target.TryMetric("oriented_height", out targetHeight))
                {
                    yield return new MetricPair(
                        "short_extent",
                        Math.Min(Math.Abs(sourceWidth), Math.Abs(sourceHeight)),
                        Math.Min(Math.Abs(targetWidth), Math.Abs(targetHeight)));
                    yield return new MetricPair(
                        "long_extent",
                        Math.Max(Math.Abs(sourceWidth), Math.Abs(sourceHeight)),
                        Math.Max(Math.Abs(targetWidth), Math.Abs(targetHeight)));
                }
                double sourceArea;
                double targetArea;
                if (source.TryMetric("area", out sourceArea)
                    && target.TryMetric("area", out targetArea))
                {
                    yield return new MetricPair(
                        "area", Math.Abs(sourceArea), Math.Abs(targetArea));
                }
            }
            else if (source.Domain == "interface_pattern")
            {
                string[] exactMetrics = { "feature_count", "spacing_count" };
                foreach (string metric in exactMetrics)
                {
                    double left;
                    double right;
                    if (source.TryMetric(metric, out left) && target.TryMetric(metric, out right))
                    {
                        yield return new MetricPair(metric, left, right);
                    }
                }
                string[] lengthMetrics =
                {
                    "spacing_minimum", "spacing_maximum",
                    "envelope_width", "envelope_height"
                };
                foreach (string metric in lengthMetrics)
                {
                    double left;
                    double right;
                    if (source.TryMetric(metric, out left) && target.TryMetric(metric, out right))
                    {
                        yield return new MetricPair(metric, Math.Abs(left), Math.Abs(right));
                    }
                }
            }
        }

        static IEnumerable<BoundDimensionPair> BoundDimensionPairs(
            CrossDrawingInterfaceObservation source,
            CrossDrawingInterfaceObservation target)
        {
            foreach (KeyValuePair<string, IList<double>> pair in source.BoundDimensionValues)
            {
                if (!pair.Key.StartsWith("supported:", StringComparison.Ordinal)) { continue; }
                IList<double> targetValues;
                if (pair.Value.Count == 1
                    && target.BoundDimensionValues.TryGetValue(pair.Key, out targetValues)
                    && targetValues.Count == 1)
                {
                    yield return new BoundDimensionPair(
                        pair.Key,
                        pair.Value[0],
                        targetValues[0]);
                }
            }
        }

        static bool SameFamily(
            CrossDrawingInterfaceObservation left,
            CrossDrawingInterfaceObservation right)
        {
            if (left == null || right == null || left.Domain != right.Domain) { return false; }
            if (left.Kind != right.Kind) { return false; }
            return string.IsNullOrEmpty(left.ShapeClass)
                || string.IsNullOrEmpty(right.ShapeClass)
                || left.ShapeClass == right.ShapeClass;
        }

        static double AllowedDifference(
            double left,
            double right,
            CrossDrawingInterfaceGraphConfig config)
        {
            return Math.Max(
                Math.Abs(config.AbsoluteMetricTolerance),
                Math.Abs(config.RelativeMetricTolerance)
                    * Math.Max(Math.Abs(left), Math.Abs(right)));
        }

        static double DistanceToBounds(
            double x,
            double y,
            CrossDrawingInterfaceObservation value)
        {
            double dx = x < value.MinX ? value.MinX - x : x > value.MaxX ? x - value.MaxX : 0;
            double dy = y < value.MinY ? value.MinY - y : y > value.MaxY ? y - value.MaxY : 0;
            return Math.Sqrt(dx * dx + dy * dy);
        }

        static double BoundsArea(CrossDrawingInterfaceObservation value)
        {
            return value.HasBounds
                ? Math.Max(0, value.MaxX - value.MinX) * Math.Max(0, value.MaxY - value.MinY)
                : double.MaxValue;
        }

        static double? DirectionDelta(
            CrossDrawingInterfaceObservation left,
            CrossDrawingInterfaceObservation right)
        {
            if (!left.HasLocalFrame || !right.HasLocalFrame) { return null; }
            double delta = Math.Abs(left.LocalDirectionDegrees - right.LocalDirectionDegrees) % 180.0;
            if (delta > 90.0) { delta = 180.0 - delta; }
            return delta;
        }

        sealed class TargetResolution
        {
            internal TargetResolution(
                List<CrossDrawingDrawingObservation> candidates,
                bool ambiguous,
                bool multiSheetSet,
                string resolution)
            {
                Candidates = candidates;
                Ambiguous = ambiguous;
                MultiSheetSet = multiSheetSet;
                Resolution = resolution;
            }

            internal List<CrossDrawingDrawingObservation> Candidates { get; private set; }
            internal bool Ambiguous { get; private set; }
            internal bool MultiSheetSet { get; private set; }
            internal string Resolution { get; private set; }
        }

        sealed class ReferenceContext
        {
            internal ReferenceContext(
                CrossDrawingDrawingObservation drawing,
                CrossDrawingComponentReferenceObservation reference)
            {
                Drawing = drawing;
                Reference = reference;
            }

            internal CrossDrawingDrawingObservation Drawing { get; private set; }
            internal CrossDrawingComponentReferenceObservation Reference { get; private set; }
        }

        sealed class ResolvedReferenceLink
        {
            internal ResolvedReferenceLink(
                CrossDrawingDrawingObservation sourceDrawing,
                CrossDrawingComponentReferenceObservation reference,
                List<CrossDrawingDrawingObservation> targetDrawings,
                string status,
                string resolution)
            {
                SourceDrawing = sourceDrawing;
                Reference = reference;
                TargetDrawings = targetDrawings;
                Status = status;
                Resolution = resolution;
            }

            internal CrossDrawingDrawingObservation SourceDrawing { get; private set; }
            internal CrossDrawingComponentReferenceObservation Reference { get; private set; }
            internal List<CrossDrawingDrawingObservation> TargetDrawings { get; private set; }
            internal string Status { get; private set; }
            internal string Resolution { get; private set; }
        }

        sealed class InterfaceContext
        {
            internal InterfaceContext(
                List<CrossDrawingInterfaceObservation> interfaces,
                string status,
                string resolution)
            {
                Interfaces = interfaces;
                Status = status;
                Resolution = resolution;
            }

            internal List<CrossDrawingInterfaceObservation> Interfaces { get; private set; }
            internal string Status { get; private set; }
            internal string Resolution { get; private set; }
        }

        sealed class InterfaceDistance
        {
            internal InterfaceDistance(
                CrossDrawingInterfaceObservation value,
                double distance)
            {
                Interface = value;
                Distance = distance;
            }

            internal CrossDrawingInterfaceObservation Interface { get; private set; }
            internal double Distance { get; private set; }
        }

        class MetricPair
        {
            internal MetricPair(string name, double source, double target)
            {
                Name = name;
                Source = source;
                Target = target;
            }

            internal string Name { get; private set; }
            internal double Source { get; private set; }
            internal double Target { get; private set; }
        }

        sealed class BoundDimensionPair : MetricPair
        {
            internal BoundDimensionPair(string name, double source, double target)
                : base(name, source, target)
            {
            }
        }

        sealed class InterfaceEvaluation
        {
            internal InterfaceEvaluation(
                CrossDrawingInterfaceObservation target,
                double score,
                int supportingMetricCount,
                bool compatible,
                bool hardConflict,
                List<CrossDrawingMetricComparisonRecord> metrics,
                List<string> support,
                List<string> conflicts)
            {
                Target = target;
                Score = score;
                SupportingMetricCount = supportingMetricCount;
                Compatible = compatible;
                HardConflict = hardConflict;
                Metrics = metrics;
                Support = support;
                Conflicts = conflicts;
            }

            internal CrossDrawingInterfaceObservation Target { get; private set; }
            internal double Score { get; private set; }
            internal int SupportingMetricCount { get; private set; }
            internal bool Compatible { get; private set; }
            internal bool HardConflict { get; private set; }
            internal List<CrossDrawingMetricComparisonRecord> Metrics { get; private set; }
            internal List<string> Support { get; private set; }
            internal List<string> Conflicts { get; private set; }
        }
    }
}
