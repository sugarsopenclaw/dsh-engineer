using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.RegularExpressions;

namespace Shb.Cad.Core
{
    public static class CrossDrawingProjectInputBuilder
    {
        static readonly Regex DrawingCodePattern = new Regex(
            @"(?<![0-9A-Za-z])([0-9A-Za-z]{2,}(?:[.\-/][0-9A-Za-z]{1,}){2,})(?![0-9A-Za-z])",
            RegexOptions.CultureInvariant | RegexOptions.Compiled);

        public static CrossDrawingDrawingObservation FromSemanticSnapshot(
            SemanticDrawingSnapshotDocument snapshot)
        {
            return FromSemanticSnapshot(snapshot, new CrossDrawingInterfaceGraphConfig());
        }

        public static CrossDrawingDrawingObservation FromSemanticSnapshot(
            SemanticDrawingSnapshotDocument snapshot,
            CrossDrawingInterfaceGraphConfig config)
        {
            if (snapshot == null) { throw new ArgumentNullException("snapshot"); }
            config = config ?? new CrossDrawingInterfaceGraphConfig();
            SemanticDrawingIdentityObservation identity = snapshot.Identity;
            var result = new CrossDrawingDrawingObservation(
                snapshot.SnapshotId,
                identity == null ? "" : identity.DrawingId,
                identity == null ? "" : identity.DrawingNumber)
                .SetTitle(
                    identity == null ? "" : identity.DrawingName,
                    identity == null ? "" : identity.Revision,
                    identity == null ? "" : identity.Stage,
                    identity == null ? "" : identity.Sheet,
                    identity == null ? "" : identity.SheetCount,
                    identity == null ? "" : identity.ProductModel)
                .SetSource(
                    identity == null ? "" : identity.SourcePath,
                    snapshot.Status,
                    snapshot.Truncated);
            if (identity != null)
            {
                foreach (KeyValuePair<string, string> pair in identity.Evidence)
                {
                    result.AddEvidence(pair.Key, pair.Value);
                }
            }

            var regionFrames = BuildRegionFrames(snapshot.Elements);
            var interfacesBySourceKey = new Dictionary<string, CrossDrawingInterfaceObservation>(
                StringComparer.Ordinal);
            foreach (SemanticDrawingElementObservation element in snapshot.Elements.Where(value =>
                value != null && (value.Domain == "interface_feature"
                    || value.Domain == "interface_pattern")))
            {
                CrossDrawingInterfaceObservation observation = BuildInterface(element, regionFrames);
                result.AddInterface(observation);
                IndexInterface(interfacesBySourceKey, observation.Id, observation);
                IndexInterface(interfacesBySourceKey, observation.SourceElementId, observation);
                foreach (string sourceId in observation.SourceIds)
                {
                    IndexInterface(interfacesBySourceKey, sourceId, observation);
                }
            }
            AttachBoundDimensions(snapshot.Elements, interfacesBySourceKey);

            int referenceCount = 0;
            foreach (SemanticDrawingElementObservation element in snapshot.Elements.Where(value =>
                value != null && value.Domain == "bom_row"))
            {
                string code = FirstValue(element.SemanticValues,
                    "part_number", "drawing_number", "code", "代号", "图样代号");
                if (string.IsNullOrWhiteSpace(code)) { continue; }
                if (referenceCount >= Math.Max(1, config.MaximumReferenceCount)) { break; }
                var reference = new CrossDrawingComponentReferenceObservation(
                    "component-ref:" + CrossDrawingMaps.Hash(snapshot.SnapshotId, element.Id, code),
                    code.Trim(),
                    "authored_bom_part_number",
                    element.Id)
                    .SetBomContext(
                        NumberOrValue(element, "item_number"),
                        FirstValue(element.SemanticValues, "name", "名称"),
                        FirstValue(element.SemanticValues, "quantity", "数量"));
                AddElementSources(reference, element);
                double pointerX;
                double pointerY;
                if (TryFirstPoint(element, "item_annotation_point_world", out pointerX, out pointerY))
                {
                    reference.SetPointer(pointerX, pointerY);
                }
                result.AddComponentReference(reference);
                referenceCount++;
            }

            int textReferenceCount = 0;
            var seenTextReferences = new HashSet<string>(StringComparer.Ordinal);
            foreach (SemanticDrawingElementObservation element in snapshot.Elements.Where(value =>
                value != null && (value.Domain == "annotation"
                    || value.Domain == "technical_requirement")))
            {
                foreach (KeyValuePair<string, string> pair in element.SemanticValues)
                {
                    if (textReferenceCount >= Math.Max(1, config.MaximumTextReferencesPerDrawing))
                    {
                        break;
                    }
                    string text = pair.Value ?? "";
                    foreach (Match match in DrawingCodePattern.Matches(text))
                    {
                        string code = match.Groups[1].Value;
                        if (!CrossDrawingMaps.LooksLikeDrawingCode(code)
                            || CrossDrawingMaps.NormalizeIdentity(code)
                                == result.NormalizedDrawingNumber)
                        {
                            continue;
                        }
                        string seenKey = element.Id + "|" + CrossDrawingMaps.NormalizeIdentity(code);
                        if (!seenTextReferences.Add(seenKey)) { continue; }
                        var reference = new CrossDrawingComponentReferenceObservation(
                            "component-ref:" + CrossDrawingMaps.Hash(
                                snapshot.SnapshotId, element.Id, code, "text"),
                            code,
                            "authored_text_reference",
                            element.Id)
                            .SetSourceText(text);
                        AddElementSources(reference, element);
                        result.AddComponentReference(reference);
                        textReferenceCount++;
                        if (textReferenceCount >= Math.Max(
                            1, config.MaximumTextReferencesPerDrawing))
                        {
                            break;
                        }
                    }
                }
            }
            if (textReferenceCount >= Math.Max(1, config.MaximumTextReferencesPerDrawing))
            {
                result.AddEvidence(
                    "text_reference_projection_status",
                    "truncated_at_configured_limit");
            }
            return result;
        }

        static CrossDrawingInterfaceObservation BuildInterface(
            SemanticDrawingElementObservation element,
            IDictionary<string, RegionFrame> regionFrames)
        {
            string shape = FirstValue(element.SemanticValues, "shape_class");
            var result = new CrossDrawingInterfaceObservation(
                "interface-ref:" + CrossDrawingMaps.Hash(element.Id, element.StableKey),
                element.Id,
                element.Domain,
                element.Kind,
                shape,
                element.EvidenceStatus)
                .SetSignatures(element.MatchSignature, element.GeometrySignature);
            string regionId = FirstAssociation(element, "region_id");
            string objectId = FirstAssociation(element, "physical_object_cluster_id");
            result.SetContext(regionId, objectId);
            if (element.HasBounds)
            {
                result.SetBounds(element.MinX, element.MinY, element.MaxX, element.MaxY);
            }
            else if (element.HasAnchor)
            {
                result.SetAnchor(element.AnchorX, element.AnchorY);
            }
            foreach (KeyValuePair<string, double> pair in element.GeometryMetrics)
            {
                result.AddMetric(pair.Key, pair.Value);
            }
            foreach (KeyValuePair<string, string> pair in element.SemanticValues)
            {
                result.AddSemanticValue(pair.Key, pair.Value);
            }
            foreach (string sourceId in element.SourceIds) { result.AddSourceId(sourceId); }
            foreach (string handle in element.SourceHandles) { result.AddSourceHandle(handle); }
            result.AddSourceId(element.StableKey);

            RegionFrame frame;
            double orientation;
            if (result.HasAnchor && !string.IsNullOrEmpty(regionId)
                && regionFrames.TryGetValue(regionId, out frame)
                && frame.Scale > 0)
            {
                double dx = result.AnchorX - frame.OriginX;
                double dy = result.AnchorY - frame.OriginY;
                double localX = (dx * frame.AxisXx + dy * frame.AxisXy) / frame.Scale;
                double localY = (dx * frame.AxisYx + dy * frame.AxisYy) / frame.Scale;
                if (!result.TryMetric("orientation_degrees", out orientation)) { orientation = 0; }
                double frameDegrees = Math.Atan2(frame.AxisXy, frame.AxisXx) * 180.0 / Math.PI;
                result.SetLocalFrame(
                    localX,
                    localY,
                    NormalizeHalfTurn(orientation - frameDegrees),
                    frame.Scale,
                    frame.ScaleSource);
            }
            return result;
        }

        static Dictionary<string, RegionFrame> BuildRegionFrames(
            IEnumerable<SemanticDrawingElementObservation> elements)
        {
            var result = new Dictionary<string, RegionFrame>(StringComparer.Ordinal);
            if (elements == null) { return result; }
            foreach (SemanticDrawingElementObservation element in elements.Where(value =>
                value != null && value.Domain == "engineering_region"))
            {
                double originX;
                double originY;
                double axisXx;
                double axisXy;
                double axisYx;
                double axisYy;
                double scale;
                if (!element.GeometryMetrics.TryGetValue("local_frame_origin_x", out originX)
                    || !element.GeometryMetrics.TryGetValue("local_frame_origin_y", out originY)
                    || !element.GeometryMetrics.TryGetValue("local_frame_axis_x_x", out axisXx)
                    || !element.GeometryMetrics.TryGetValue("local_frame_axis_x_y", out axisXy)
                    || !element.GeometryMetrics.TryGetValue("local_frame_axis_y_x", out axisYx)
                    || !element.GeometryMetrics.TryGetValue("local_frame_axis_y_y", out axisYy)
                    || !element.GeometryMetrics.TryGetValue("local_frame_scale", out scale)
                    || scale <= 0)
                {
                    continue;
                }
                string source = FirstValue(element.SemanticValues, "local_frame_scale_source");
                var frame = new RegionFrame(
                    originX, originY, axisXx, axisXy, axisYx, axisYy, scale, source);
                IndexRegionFrame(result, element.StableKey, frame);
                IndexRegionFrame(result, element.Id, frame);
                foreach (string id in element.SourceIds) { IndexRegionFrame(result, id, frame); }
            }
            return result;
        }

        static void AttachBoundDimensions(
            IEnumerable<SemanticDrawingElementObservation> elements,
            IDictionary<string, CrossDrawingInterfaceObservation> interfacesBySourceKey)
        {
            if (elements == null) { return; }
            foreach (SemanticDrawingElementObservation dimension in elements.Where(value =>
                value != null && value.Domain == "dimension_binding"))
            {
                IList<string> interfaceIds;
                if (!dimension.Associations.TryGetValue("interface_feature_id", out interfaceIds)
                    || interfaceIds == null || interfaceIds.Count == 0)
                {
                    continue;
                }
                string status = FirstValue(dimension.SemanticValues, "status");
                bool unique = status == "bound_unique";
                double value;
                string valueBasis = "";
                if (dimension.SemanticNumbers.TryGetValue("effective_displayed_value", out value))
                {
                    valueBasis = "authored_displayed_dimension";
                }
                else if (dimension.SemanticNumbers.TryGetValue("entity_measurement", out value))
                {
                    valueBasis = "authored_dimension_measurement";
                }
                else
                {
                    continue;
                }
                string key = (unique ? "supported:" : "candidate:")
                    + valueBasis + ":" + (dimension.Kind ?? "unknown");
                foreach (string interfaceId in interfaceIds)
                {
                    CrossDrawingInterfaceObservation target;
                    if (interfacesBySourceKey.TryGetValue(interfaceId, out target))
                    {
                        target.AddBoundDimensionValue(key, value)
                            .AddSourceId(dimension.Id);
                    }
                }
            }
        }

        static void AddElementSources(
            CrossDrawingComponentReferenceObservation reference,
            SemanticDrawingElementObservation element)
        {
            reference.AddSourceId(element.Id);
            foreach (string sourceId in element.SourceIds) { reference.AddSourceId(sourceId); }
            foreach (string handle in element.SourceHandles) { reference.AddSourceHandle(handle); }
        }

        static string FirstValue(IDictionary<string, string> values, params string[] keys)
        {
            if (values == null || keys == null) { return ""; }
            foreach (string key in keys)
            {
                string value;
                if (values.TryGetValue(key, out value) && !string.IsNullOrWhiteSpace(value))
                {
                    return value.Trim();
                }
            }
            return "";
        }

        static string NumberOrValue(SemanticDrawingElementObservation element, string key)
        {
            string text = FirstValue(element.SemanticValues, key);
            if (!string.IsNullOrEmpty(text)) { return text; }
            double number;
            return element.SemanticNumbers.TryGetValue(key, out number)
                ? number.ToString("G17", CultureInfo.InvariantCulture)
                : "";
        }

        static string FirstAssociation(SemanticDrawingElementObservation element, string key)
        {
            IList<string> values;
            return element != null && element.Associations.TryGetValue(key, out values)
                && values != null && values.Count > 0
                ? values[0]
                : "";
        }

        static bool TryFirstPoint(
            SemanticDrawingElementObservation element,
            string key,
            out double x,
            out double y)
        {
            x = 0;
            y = 0;
            string token = FirstAssociation(element, key);
            if (string.IsNullOrWhiteSpace(token)) { return false; }
            string[] parts = token.Split(',');
            return parts.Length >= 2
                && double.TryParse(parts[0], NumberStyles.Float, CultureInfo.InvariantCulture, out x)
                && double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out y)
                && CrossDrawingMaps.IsFinite(x) && CrossDrawingMaps.IsFinite(y);
        }

        static void IndexInterface(
            IDictionary<string, CrossDrawingInterfaceObservation> index,
            string key,
            CrossDrawingInterfaceObservation value)
        {
            if (!string.IsNullOrWhiteSpace(key) && !index.ContainsKey(key)) { index[key] = value; }
        }

        static void IndexRegionFrame(
            IDictionary<string, RegionFrame> index,
            string key,
            RegionFrame value)
        {
            if (!string.IsNullOrWhiteSpace(key) && !index.ContainsKey(key)) { index[key] = value; }
        }

        static double NormalizeHalfTurn(double degrees)
        {
            double value = degrees % 180.0;
            if (value < 0) { value += 180.0; }
            return value;
        }

        sealed class RegionFrame
        {
            internal RegionFrame(
                double originX,
                double originY,
                double axisXx,
                double axisXy,
                double axisYx,
                double axisYy,
                double scale,
                string scaleSource)
            {
                OriginX = originX;
                OriginY = originY;
                AxisXx = axisXx;
                AxisXy = axisXy;
                AxisYx = axisYx;
                AxisYy = axisYy;
                Scale = scale;
                ScaleSource = scaleSource ?? "";
            }

            internal double OriginX { get; private set; }
            internal double OriginY { get; private set; }
            internal double AxisXx { get; private set; }
            internal double AxisXy { get; private set; }
            internal double AxisYx { get; private set; }
            internal double AxisYy { get; private set; }
            internal double Scale { get; private set; }
            internal string ScaleSource { get; private set; }
        }
    }
}
