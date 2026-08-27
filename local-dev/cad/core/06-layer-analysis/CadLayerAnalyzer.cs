using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace Shb.Cad.Core
{
    public sealed class CadLayerDefinitionObservation
    {
        public CadLayerDefinitionObservation(
            string name,
            string handle,
            bool isOff,
            bool isFrozen,
            bool isLocked,
            string color,
            string linetype)
        {
            Name = name ?? "";
            Handle = handle ?? "";
            IsOff = isOff;
            IsFrozen = isFrozen;
            IsLocked = isLocked;
            Color = color ?? "";
            Linetype = linetype ?? "";
        }

        public string Name { get; private set; }
        public string Handle { get; private set; }
        public bool IsOff { get; private set; }
        public bool IsFrozen { get; private set; }
        public bool IsLocked { get; private set; }
        public string Color { get; private set; }
        public string Linetype { get; private set; }
        public bool SuppressesDisplay { get { return IsOff || IsFrozen; } }
    }

    public sealed class CadLayerEntityObservation
    {
        public CadLayerEntityObservation(
            string handle,
            string layerName,
            string ownerScope,
            string ownerBlockName,
            string managedType,
            bool isVisible,
            bool isProxy,
            string referencedBlockName)
        {
            Handle = handle ?? "";
            LayerName = layerName ?? "";
            OwnerScope = ownerScope ?? "";
            OwnerBlockName = ownerBlockName ?? "";
            ManagedType = managedType ?? "";
            IsVisible = isVisible;
            IsProxy = isProxy;
            ReferencedBlockName = referencedBlockName ?? "";
        }

        public string Handle { get; private set; }
        public string LayerName { get; private set; }
        public string OwnerScope { get; private set; }
        public string OwnerBlockName { get; private set; }
        public string ManagedType { get; private set; }
        public bool IsVisible { get; private set; }
        public bool IsProxy { get; private set; }
        public string ReferencedBlockName { get; private set; }
        public bool IsBlockReference
        {
            get
            {
                return string.Equals(ManagedType, "BlockReference", StringComparison.Ordinal)
                    || string.Equals(ManagedType, "AcDbBlockReference", StringComparison.Ordinal);
            }
        }
    }

    public sealed class CadLayerSummary
    {
        internal CadLayerSummary(CadLayerDefinitionObservation definition, string fallbackName)
        {
            Definition = definition;
            Name = definition == null ? (fallbackName ?? "") : definition.Name;
            OwnerScopeCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            EntityTypeCounts = new Dictionary<string, int>(StringComparer.Ordinal);
            SampleEntityHandles = new List<string>();
            ReferencedBlockNames = new List<string>();
        }

        public CadLayerDefinitionObservation Definition { get; private set; }
        public string Name { get; private set; }
        public bool IsDefined { get { return Definition != null; } }
        public bool IsOff { get { return Definition != null && Definition.IsOff; } }
        public bool IsFrozen { get { return Definition != null && Definition.IsFrozen; } }
        public bool IsLocked { get { return Definition != null && Definition.IsLocked; } }
        public bool SuppressesDisplay { get { return Definition != null && Definition.SuppressesDisplay; } }
        public int EntityCount { get; internal set; }
        public int ModelSpaceEntityCount { get; internal set; }
        public int BlockDefinitionEntityCount { get; internal set; }
        public int BlockReferenceCount { get; internal set; }
        public int ExplicitlyInvisibleEntityCount { get; internal set; }
        public int LayerSuppressedModelEntityCount { get; internal set; }
        public int DirectlyDisplayableModelEntityCount { get; internal set; }
        public int ProxyEntityCount { get; internal set; }
        public IDictionary<string, int> OwnerScopeCounts { get; private set; }
        public IDictionary<string, int> EntityTypeCounts { get; private set; }
        public IList<string> SampleEntityHandles { get; private set; }
        public IList<string> ReferencedBlockNames { get; private set; }

        internal void Add(CadLayerEntityObservation entity, int sampleLimit)
        {
            EntityCount++;
            Increment(OwnerScopeCounts, EmptyLabel(entity.OwnerScope));
            Increment(EntityTypeCounts, EmptyLabel(entity.ManagedType));
            if (string.Equals(entity.OwnerScope, "model_space", StringComparison.Ordinal))
            {
                ModelSpaceEntityCount++;
                if (SuppressesDisplay)
                {
                    LayerSuppressedModelEntityCount++;
                }
                if (entity.IsVisible && !SuppressesDisplay)
                {
                    DirectlyDisplayableModelEntityCount++;
                }
            }
            else if (string.Equals(entity.OwnerScope, "block_definition", StringComparison.Ordinal))
            {
                BlockDefinitionEntityCount++;
            }
            if (!entity.IsVisible)
            {
                ExplicitlyInvisibleEntityCount++;
            }
            if (entity.IsProxy)
            {
                ProxyEntityCount++;
            }
            if (entity.IsBlockReference)
            {
                BlockReferenceCount++;
                AddUnique(ReferencedBlockNames, entity.ReferencedBlockName);
            }
            if (SampleEntityHandles.Count < sampleLimit && !string.IsNullOrEmpty(entity.Handle))
            {
                SampleEntityHandles.Add(entity.Handle);
            }
        }

        internal Dictionary<string, object> ToMap()
        {
            return LayerAnalysisMaps.Map(
                "name", Name,
                "defined", IsDefined,
                "definition", Definition == null
                    ? null
                    : LayerAnalysisMaps.Map(
                        "handle", Definition.Handle,
                        "off", Definition.IsOff,
                        "frozen", Definition.IsFrozen,
                        "locked", Definition.IsLocked,
                        "suppresses_display", Definition.SuppressesDisplay,
                        "color", Definition.Color,
                        "linetype", Definition.Linetype),
                "used", EntityCount > 0,
                "entity_count", EntityCount,
                "model_space_entity_count", ModelSpaceEntityCount,
                "block_definition_entity_count", BlockDefinitionEntityCount,
                "block_reference_count", BlockReferenceCount,
                "explicitly_invisible_entity_count", ExplicitlyInvisibleEntityCount,
                "layer_suppressed_model_entity_count", LayerSuppressedModelEntityCount,
                "directly_displayable_model_entity_count", DirectlyDisplayableModelEntityCount,
                "proxy_entity_count", ProxyEntityCount,
                "owner_scope_counts", OwnerScopeCounts,
                "entity_type_counts", EntityTypeCounts,
                "referenced_block_names", ReferencedBlockNames,
                "sample_entity_handles", SampleEntityHandles);
        }

        static void Increment(IDictionary<string, int> values, string key)
        {
            values[key] = values.ContainsKey(key) ? values[key] + 1 : 1;
        }

        static string EmptyLabel(string value)
        {
            return string.IsNullOrEmpty(value) ? "(empty)" : value;
        }

        static void AddUnique(IList<string> values, string value)
        {
            if (string.IsNullOrEmpty(value))
            {
                return;
            }
            foreach (string existing in values)
            {
                if (string.Equals(existing, value, StringComparison.Ordinal))
                {
                    return;
                }
            }
            values.Add(value);
        }
    }

    public sealed class CadLayerAnalysisDocument
    {
        readonly IList<CadLayerEntityObservation> sourceEntities;

        internal CadLayerAnalysisDocument(
            string drawingId,
            IList<CadLayerEntityObservation> entities)
        {
            DrawingId = drawingId ?? "";
            sourceEntities = entities;
            Layers = new List<CadLayerSummary>();
            DuplicateDefinitionNames = new List<string>();
            UndefinedReferencedLayerNames = new List<string>();
            UnusedDefinedLayerNames = new List<string>();
            OwnerScopeCounts = new Dictionary<string, int>(StringComparer.Ordinal);
        }

        public string DrawingId { get; private set; }
        public IList<CadLayerSummary> Layers { get; private set; }
        public int DefinedLayerCount { get; internal set; }
        public int UsedDefinedLayerCount { get; internal set; }
        public int EntityCount { get; internal set; }
        public int EntityWithoutLayerCount { get; internal set; }
        public int ModelSpaceEntityCount { get; internal set; }
        public int BlockDefinitionEntityCount { get; internal set; }
        public int ModelSpaceBlockReferenceCount { get; internal set; }
        public int LayerZeroModelBlockReferenceCount { get; internal set; }
        public int LayerZeroBlockDefinitionEntityCount { get; internal set; }
        public int ExplicitlyInvisibleModelEntityCount { get; internal set; }
        public int LayerSuppressedModelEntityCount { get; internal set; }
        public int DirectlyDisplayableModelEntityCount { get; internal set; }
        public IList<string> DuplicateDefinitionNames { get; private set; }
        public IList<string> UndefinedReferencedLayerNames { get; private set; }
        public IList<string> UnusedDefinedLayerNames { get; private set; }
        public IDictionary<string, int> OwnerScopeCounts { get; private set; }

        public IList<string> FindEntityHandles(string layerName, string ownerScope = null)
        {
            var handles = new List<string>();
            foreach (CadLayerEntityObservation entity in sourceEntities)
            {
                if (string.Equals(entity.LayerName, layerName, StringComparison.OrdinalIgnoreCase)
                    && (ownerScope == null
                        || string.Equals(entity.OwnerScope, ownerScope, StringComparison.Ordinal)))
                {
                    handles.Add(entity.Handle);
                }
            }
            return handles;
        }

        public CadLayerSummary FindLayer(string layerName)
        {
            foreach (CadLayerSummary layer in Layers)
            {
                if (string.Equals(layer.Name, layerName, StringComparison.OrdinalIgnoreCase))
                {
                    return layer;
                }
            }
            return null;
        }

        public Dictionary<string, object> ToMap()
        {
            var layers = new List<Dictionary<string, object>>();
            var offLayers = new List<string>();
            var frozenLayers = new List<string>();
            var lockedLayers = new List<string>();
            foreach (CadLayerSummary layer in Layers)
            {
                layers.Add(layer.ToMap());
                if (layer.IsOff)
                {
                    offLayers.Add(layer.Name);
                }
                if (layer.IsFrozen)
                {
                    frozenLayers.Add(layer.Name);
                }
                if (layer.IsLocked)
                {
                    lockedLayers.Add(layer.Name);
                }
            }

            return LayerAnalysisMaps.Map(
                "schema_version", "1",
                "analysis_type", "cad_layers",
                "analyzer", "cad_layer_analyzer",
                "analyzer_version", "1",
                "drawing_id", DrawingId,
                "definition_count", DefinedLayerCount,
                "used_definition_count", UsedDefinedLayerCount,
                "unused_definition_count", UnusedDefinedLayerNames.Count,
                "unused_defined_layers", UnusedDefinedLayerNames,
                "duplicate_definition_names", DuplicateDefinitionNames,
                "undefined_referenced_layers", UndefinedReferencedLayerNames,
                "entity_count", EntityCount,
                "entity_without_layer_count", EntityWithoutLayerCount,
                "owner_scope_counts", OwnerScopeCounts,
                "model_space_entity_count", ModelSpaceEntityCount,
                "block_definition_entity_count", BlockDefinitionEntityCount,
                "model_space_block_reference_count", ModelSpaceBlockReferenceCount,
                "layer_zero_model_block_reference_count", LayerZeroModelBlockReferenceCount,
                "layer_zero_block_definition_entity_count", LayerZeroBlockDefinitionEntityCount,
                "current_display_state", LayerAnalysisMaps.Map(
                    "off_layers", offLayers,
                    "frozen_layers", frozenLayers,
                    "locked_layers", lockedLayers,
                    "explicitly_invisible_model_entities", ExplicitlyInvisibleModelEntityCount,
                    "layer_suppressed_model_entities", LayerSuppressedModelEntityCount,
                    "directly_displayable_model_entities", DirectlyDisplayableModelEntityCount),
                "layers", layers,
                "block_visibility_notes", new[]
                {
                    "model_space_entities_follow_their_assigned_layer_state",
                    "entity_visible_does_not_include_layer_off_or_frozen_state",
                    "turning_off_or_freezing_an_insert_layer_can_hide_the_whole_block_reference",
                    "nonzero_layers_inside_block_definitions_remain_independently_controllable",
                    "layer_zero_content_inside_blocks_can_follow_the_insert_layer"
                },
                "limits", new[]
                {
                    "counts_database_entities_not_rendered_occurrences",
                    "block_definition_entities_are_counted_separately_from_model_space",
                    "nested_attribute_references_are_not_individual_entity_rows",
                    "analysis_is_read_only_and_does_not_change_layer_state"
                });
        }

        public string ToMarkdown()
        {
            var markdown = new StringBuilder();
            markdown.AppendLine("# 图层分析");
            markdown.AppendLine();
            markdown.Append("图纸：`");
            markdown.Append((DrawingId ?? "").Replace("`", "\\`"));
            markdown.AppendLine("`");
            markdown.AppendLine();
            markdown.AppendLine("## 概览");
            markdown.AppendLine();
            markdown.Append("- 已定义图层：");
            markdown.Append(DefinedLayerCount.ToString(CultureInfo.InvariantCulture));
            markdown.Append("；已使用：");
            markdown.Append(UsedDefinedLayerCount.ToString(CultureInfo.InvariantCulture));
            markdown.Append("；未使用：");
            markdown.AppendLine(UnusedDefinedLayerNames.Count.ToString(CultureInfo.InvariantCulture));
            markdown.Append("- 模型空间实体：");
            markdown.Append(ModelSpaceEntityCount.ToString(CultureInfo.InvariantCulture));
            markdown.Append("；块定义实体：");
            markdown.AppendLine(BlockDefinitionEntityCount.ToString(CultureInfo.InvariantCulture));
            markdown.Append("- 当前可直接显示的模型空间实体：");
            markdown.Append(DirectlyDisplayableModelEntityCount.ToString(CultureInfo.InvariantCulture));
            markdown.Append("；被关闭/冻结图层压住：");
            markdown.AppendLine(LayerSuppressedModelEntityCount.ToString(CultureInfo.InvariantCulture));
            if (UndefinedReferencedLayerNames.Count == 0 && EntityWithoutLayerCount == 0)
            {
                markdown.AppendLine("- 图层引用完整：所有实体均能对应到已定义图层。");
            }
            else
            {
                markdown.Append("- 图层引用异常：未定义图层 ");
                markdown.Append(UndefinedReferencedLayerNames.Count.ToString(CultureInfo.InvariantCulture));
                markdown.Append(" 个，无图层实体 ");
                markdown.Append(EntityWithoutLayerCount.ToString(CultureInfo.InvariantCulture));
                markdown.AppendLine(" 个。");
            }

            var used = new List<CadLayerSummary>();
            var unused = new List<CadLayerSummary>();
            foreach (CadLayerSummary layer in Layers)
            {
                if (layer.EntityCount > 0)
                {
                    used.Add(layer);
                }
                else if (layer.IsDefined)
                {
                    unused.Add(layer);
                }
            }
            used.Sort(CompareLayerUsage);
            unused.Sort(CompareLayerName);

            markdown.AppendLine();
            markdown.AppendLine("## 已使用图层");
            markdown.AppendLine();
            foreach (CadLayerSummary layer in used)
            {
                AppendLayer(markdown, layer);
            }
            markdown.AppendLine();
            markdown.AppendLine("## 已定义但未使用");
            markdown.AppendLine();
            if (unused.Count == 0)
            {
                markdown.AppendLine("- 无");
            }
            else
            {
                foreach (CadLayerSummary layer in unused)
                {
                    markdown.Append("- `");
                    markdown.Append(layer.Name.Replace("`", "\\`"));
                    markdown.Append("`");
                    AppendDefinitionStyle(markdown, layer);
                    markdown.AppendLine();
                }
            }

            markdown.AppendLine();
            markdown.AppendLine("## 块参照与显示/隐藏");
            markdown.AppendLine();
            markdown.AppendLine("- 模型空间普通实体会受自身图层的开/关、冻结状态控制。");
            markdown.AppendLine("- 块参照本身也有图层；关闭其插入图层可以隐藏整个块参照。");
            markdown.AppendLine("- 块定义内部的非 0 层实体还受各自图层控制；0 层内容通常随块参照插入层表现。");
            markdown.AppendLine("- 本分析只读，不会修改当前图纸的图层状态。");
            return markdown.ToString();
        }

        static void AppendLayer(StringBuilder markdown, CadLayerSummary layer)
        {
            markdown.Append("- `");
            markdown.Append(layer.Name.Replace("`", "\\`"));
            markdown.Append("`");
            if (layer.IsOff)
            {
                markdown.Append(" **[关闭]**");
            }
            if (layer.IsFrozen)
            {
                markdown.Append(" **[冻结]**");
            }
            if (layer.IsLocked)
            {
                markdown.Append(" [锁定]");
            }
            markdown.Append("：模型空间 ");
            markdown.Append(layer.ModelSpaceEntityCount.ToString(CultureInfo.InvariantCulture));
            markdown.Append("，块定义 ");
            markdown.Append(layer.BlockDefinitionEntityCount.ToString(CultureInfo.InvariantCulture));
            markdown.Append("，合计 ");
            markdown.Append(layer.EntityCount.ToString(CultureInfo.InvariantCulture));
            string topTypes = RenderTopTypes(layer.EntityTypeCounts, 3);
            if (topTypes.Length > 0)
            {
                markdown.Append("；主要类型：");
                markdown.Append(topTypes);
            }
            AppendDefinitionStyle(markdown, layer);
            markdown.AppendLine();
        }

        static void AppendDefinitionStyle(StringBuilder markdown, CadLayerSummary layer)
        {
            if (layer.Definition == null)
            {
                markdown.Append("；未找到图层定义");
                return;
            }
            markdown.Append("；颜色 ");
            markdown.Append(layer.Definition.Color);
            markdown.Append("，线型 ");
            markdown.Append(layer.Definition.Linetype);
        }

        static string RenderTopTypes(IDictionary<string, int> counts, int maximum)
        {
            var values = new List<KeyValuePair<string, int>>(counts);
            values.Sort(CompareTypeCount);
            var rendered = new List<string>();
            for (int index = 0; index < values.Count && index < maximum; index++)
            {
                rendered.Add(values[index].Key + " "
                    + values[index].Value.ToString(CultureInfo.InvariantCulture));
            }
            return string.Join("、", rendered.ToArray());
        }

        static int CompareLayerUsage(CadLayerSummary left, CadLayerSummary right)
        {
            int model = right.ModelSpaceEntityCount.CompareTo(left.ModelSpaceEntityCount);
            if (model != 0)
            {
                return model;
            }
            int total = right.EntityCount.CompareTo(left.EntityCount);
            return total != 0 ? total : CompareLayerName(left, right);
        }

        static int CompareLayerName(CadLayerSummary left, CadLayerSummary right)
        {
            return string.Compare(left.Name, right.Name, StringComparison.Ordinal);
        }

        static int CompareTypeCount(
            KeyValuePair<string, int> left,
            KeyValuePair<string, int> right)
        {
            int count = right.Value.CompareTo(left.Value);
            return count != 0
                ? count
                : string.Compare(left.Key, right.Key, StringComparison.Ordinal);
        }
    }

    public static class CadLayerAnalyzer
    {
        public static CadLayerAnalysisDocument Analyze(
            string drawingId,
            IList<CadLayerDefinitionObservation> definitions,
            IList<CadLayerEntityObservation> entities,
            int sampleHandleLimit = 8)
        {
            if (definitions == null)
            {
                throw new ArgumentNullException("definitions");
            }
            if (entities == null)
            {
                throw new ArgumentNullException("entities");
            }
            if (sampleHandleLimit < 0)
            {
                throw new ArgumentOutOfRangeException("sampleHandleLimit");
            }

            var document = new CadLayerAnalysisDocument(drawingId, entities);
            var byName = new Dictionary<string, CadLayerSummary>(StringComparer.OrdinalIgnoreCase);
            foreach (CadLayerDefinitionObservation definition in definitions)
            {
                if (definition == null || string.IsNullOrEmpty(definition.Name))
                {
                    continue;
                }
                if (byName.ContainsKey(definition.Name))
                {
                    AddUnique(document.DuplicateDefinitionNames, definition.Name);
                    continue;
                }
                var summary = new CadLayerSummary(definition, definition.Name);
                byName[definition.Name] = summary;
                document.Layers.Add(summary);
                document.DefinedLayerCount++;
            }

            foreach (CadLayerEntityObservation entity in entities)
            {
                if (entity == null)
                {
                    continue;
                }
                document.EntityCount++;
                Increment(document.OwnerScopeCounts, EmptyLabel(entity.OwnerScope));
                if (string.Equals(entity.OwnerScope, "model_space", StringComparison.Ordinal))
                {
                    document.ModelSpaceEntityCount++;
                    if (!entity.IsVisible)
                    {
                        document.ExplicitlyInvisibleModelEntityCount++;
                    }
                    if (entity.IsBlockReference)
                    {
                        document.ModelSpaceBlockReferenceCount++;
                        if (string.Equals(entity.LayerName, "0", StringComparison.OrdinalIgnoreCase))
                        {
                            document.LayerZeroModelBlockReferenceCount++;
                        }
                    }
                }
                else if (string.Equals(entity.OwnerScope, "block_definition", StringComparison.Ordinal))
                {
                    document.BlockDefinitionEntityCount++;
                    if (string.Equals(entity.LayerName, "0", StringComparison.OrdinalIgnoreCase))
                    {
                        document.LayerZeroBlockDefinitionEntityCount++;
                    }
                }

                if (string.IsNullOrEmpty(entity.LayerName))
                {
                    document.EntityWithoutLayerCount++;
                    continue;
                }

                CadLayerSummary layer;
                if (!byName.TryGetValue(entity.LayerName, out layer))
                {
                    layer = new CadLayerSummary(null, entity.LayerName);
                    byName[entity.LayerName] = layer;
                    document.Layers.Add(layer);
                    AddUnique(document.UndefinedReferencedLayerNames, entity.LayerName);
                }
                layer.Add(entity, sampleHandleLimit);
                if (string.Equals(entity.OwnerScope, "model_space", StringComparison.Ordinal))
                {
                    if (layer.SuppressesDisplay)
                    {
                        document.LayerSuppressedModelEntityCount++;
                    }
                    if (entity.IsVisible && !layer.SuppressesDisplay)
                    {
                        document.DirectlyDisplayableModelEntityCount++;
                    }
                }
            }

            foreach (CadLayerSummary layer in document.Layers)
            {
                if (!layer.IsDefined)
                {
                    continue;
                }
                if (layer.EntityCount > 0)
                {
                    document.UsedDefinedLayerCount++;
                }
                else
                {
                    document.UnusedDefinedLayerNames.Add(layer.Name);
                }
            }
            SortStrings(document.DuplicateDefinitionNames);
            SortStrings(document.UndefinedReferencedLayerNames);
            SortStrings(document.UnusedDefinedLayerNames);
            return document;
        }

        static void Increment(IDictionary<string, int> values, string key)
        {
            values[key] = values.ContainsKey(key) ? values[key] + 1 : 1;
        }

        static string EmptyLabel(string value)
        {
            return string.IsNullOrEmpty(value) ? "(empty)" : value;
        }

        static void AddUnique(IList<string> values, string value)
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

        static void SortStrings(IList<string> values)
        {
            var list = values as List<string>;
            if (list != null)
            {
                list.Sort(StringComparer.Ordinal);
            }
        }
    }

    internal static class LayerAnalysisMaps
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
