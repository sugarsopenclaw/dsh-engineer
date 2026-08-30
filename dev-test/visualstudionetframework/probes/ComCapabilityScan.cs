using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

namespace Shb.Thcad.Probes
{
    /// <summary>
    /// Reflects TlbImp interop assemblies into a path-free COM scan document.
    /// C# 5 compatible so Windows PowerShell Add-Type can compile it.
    /// </summary>
    public static class ComCapabilityScan
    {
        public static string ScanTypeLibrary(
            string assemblyPath,
            string label,
            string bitness,
            string fileName,
            string version,
            string sha256)
        {
            return ScanTypeLibrary(assemblyPath, label, bitness, fileName, version, sha256, null);
        }

        public static string ScanTypeLibrary(
            string assemblyPath,
            string label,
            string bitness,
            string fileName,
            string version,
            string sha256,
            IList<string> aggregatedReflectionErrors)
        {
            if (assemblyPath == null)
            {
                throw new ArgumentNullException("assemblyPath");
            }

            Assembly assembly = Assembly.LoadFrom(assemblyPath);
            List<string> reflectionErrors = new List<string>();
            Type[] types = GetAssemblyTypes(assembly, reflectionErrors);
            if (aggregatedReflectionErrors != null)
            {
                for (int errorIndex = 0; errorIndex < reflectionErrors.Count; errorIndex++)
                {
                    aggregatedReflectionErrors.Add(ErrorObject(label, reflectionErrors[errorIndex]));
                }
            }

            List<Type> interfaces = new List<Type>();
            for (int i = 0; i < types.Length; i++)
            {
                Type type = types[i];
                if (type != null && type.IsInterface)
                {
                    interfaces.Add(type);
                }
            }
            interfaces.Sort(CompareTypes);

            BindingFlags flags =
                BindingFlags.Public |
                BindingFlags.Instance |
                BindingFlags.Static |
                BindingFlags.DeclaredOnly;

            int declaredMethods = 0;
            int declaredProperties = 0;
            int declaredEvents = 0;
            StringBuilder interfacesJson = new StringBuilder();
            interfacesJson.Append('[');
            for (int i = 0; i < interfaces.Count; i++)
            {
                if (i > 0)
                {
                    interfacesJson.Append(',');
                }
                int methodCount;
                int propertyCount;
                int eventCount;
                WriteInterface(interfacesJson, interfaces[i], flags, out methodCount, out propertyCount, out eventCount);
                declaredMethods += methodCount;
                declaredProperties += propertyCount;
                declaredEvents += eventCount;
            }
            interfacesJson.Append(']');

            StringBuilder json = new StringBuilder();
            json.Append('{');
            WriteKey(json, "label");
            WriteString(json, label);
            json.Append(',');
            WriteKey(json, "bitness");
            WriteString(json, bitness);
            json.Append(',');
            WriteKey(json, "file_name");
            WriteString(json, fileName);
            json.Append(',');
            WriteKey(json, "version");
            WriteStringOrNull(json, EmptyToNull(version));
            json.Append(',');
            WriteKey(json, "sha256");
            WriteStringOrNull(json, EmptyToNull(sha256));
            json.Append(',');
            WriteKey(json, "interface_count");
            json.Append(interfaces.Count.ToString(CultureInfo.InvariantCulture));
            json.Append(',');
            WriteKey(json, "declared_method_count");
            json.Append(declaredMethods.ToString(CultureInfo.InvariantCulture));
            json.Append(',');
            WriteKey(json, "declared_property_count");
            json.Append(declaredProperties.ToString(CultureInfo.InvariantCulture));
            json.Append(',');
            WriteKey(json, "declared_event_count");
            json.Append(declaredEvents.ToString(CultureInfo.InvariantCulture));
            json.Append(',');
            WriteKey(json, "reflection_errors");
            WriteStringArray(json, reflectionErrors);
            json.Append(',');
            WriteKey(json, "interfaces");
            json.Append(interfacesJson.ToString());
            json.Append('}');
            return json.ToString();
        }

        public static string EmptyTypeLibrary(
            string label,
            string bitness,
            string fileName,
            string version,
            string sha256)
        {
            StringBuilder json = new StringBuilder();
            json.Append('{');
            WriteKey(json, "label");
            WriteString(json, label);
            json.Append(',');
            WriteKey(json, "bitness");
            WriteString(json, bitness);
            json.Append(',');
            WriteKey(json, "file_name");
            WriteString(json, fileName);
            json.Append(',');
            WriteKey(json, "version");
            WriteStringOrNull(json, EmptyToNull(version));
            json.Append(',');
            WriteKey(json, "sha256");
            WriteStringOrNull(json, EmptyToNull(sha256));
            json.Append(',');
            WriteKey(json, "interface_count");
            json.Append('0');
            json.Append(',');
            WriteKey(json, "declared_method_count");
            json.Append('0');
            json.Append(',');
            WriteKey(json, "declared_property_count");
            json.Append('0');
            json.Append(',');
            WriteKey(json, "declared_event_count");
            json.Append('0');
            json.Append(',');
            WriteKey(json, "reflection_errors");
            json.Append("[]");
            json.Append(',');
            WriteKey(json, "interfaces");
            json.Append("[]");
            json.Append('}');
            return json.ToString();
        }

        public static string ProgIdObject(
            string progId,
            string clsid,
            string serverKind,
            string typeLib,
            string registryView)
        {
            StringBuilder json = new StringBuilder();
            json.Append('{');
            WriteKey(json, "prog_id");
            WriteString(json, progId);
            json.Append(',');
            WriteKey(json, "clsid");
            WriteStringOrNull(json, NormalizeGuid(clsid));
            json.Append(',');
            WriteKey(json, "server_kind");
            WriteStringOrNull(json, EmptyToNull(serverKind));
            json.Append(',');
            WriteKey(json, "type_lib");
            WriteStringOrNull(json, NormalizeGuid(typeLib));
            json.Append(',');
            WriteKey(json, "registry_view");
            WriteStringOrNull(json, EmptyToNull(registryView));
            json.Append('}');
            return json.ToString();
        }

        public static string ErrorObject(string source, string message)
        {
            StringBuilder json = new StringBuilder();
            json.Append('{');
            WriteKey(json, "source");
            WriteString(json, source);
            json.Append(',');
            WriteKey(json, "message");
            WriteString(json, SanitizeMessage(message));
            json.Append('}');
            return json.ToString();
        }

        public static void WriteScanDocument(
            string outputPath,
            string inventoryId,
            string observedHostId,
            IList<string> typeLibraryJsonObjects,
            IList<string> progIdJsonObjects,
            IList<string> conversionErrorJsonObjects,
            IList<string> reflectionErrorJsonObjects)
        {
            if (outputPath == null)
            {
                throw new ArgumentNullException("outputPath");
            }

            StringBuilder json = new StringBuilder();
            json.Append('{');
            WriteKey(json, "inventory_id");
            WriteString(json, inventoryId);
            json.Append(',');
            WriteKey(json, "observed_host_id");
            WriteString(json, observedHostId);
            json.Append(',');
            WriteKey(json, "type_libraries");
            WriteRawObjectArray(json, typeLibraryJsonObjects);
            json.Append(',');
            WriteKey(json, "progids");
            WriteRawObjectArray(json, progIdJsonObjects);
            json.Append(',');
            WriteKey(json, "conversion_errors");
            WriteRawObjectArray(json, conversionErrorJsonObjects);
            json.Append(',');
            WriteKey(json, "reflection_errors");
            WriteRawObjectArray(json, reflectionErrorJsonObjects);
            json.Append('}');
            File.WriteAllText(outputPath, json.ToString(), new UTF8Encoding(false));
        }

        static Type[] GetAssemblyTypes(Assembly assembly, List<string> reflectionErrors)
        {
            try
            {
                return assembly.GetTypes();
            }
            catch (ReflectionTypeLoadException ex)
            {
                if (ex.LoaderExceptions != null)
                {
                    for (int i = 0; i < ex.LoaderExceptions.Length; i++)
                    {
                        Exception loaderError = ex.LoaderExceptions[i];
                        if (loaderError != null)
                        {
                            reflectionErrors.Add(SanitizeMessage(loaderError.Message));
                        }
                    }
                }
                return ex.Types ?? new Type[0];
            }
        }

        static void WriteInterface(
            StringBuilder json,
            Type type,
            BindingFlags flags,
            out int methodCount,
            out int propertyCount,
            out int eventCount)
        {
            MethodInfo[] methods = FilterOrdinaryMethods(type.GetMethods(flags));
            Array.Sort(methods, CompareMethods);
            PropertyInfo[] properties = type.GetProperties(flags);
            Array.Sort(properties, CompareProperties);
            EventInfo[] events = type.GetEvents(flags);
            Array.Sort(events, CompareEvents);

            methodCount = methods.Length;
            propertyCount = properties.Length;
            eventCount = events.Length;

            json.Append('{');
            WriteKey(json, "name");
            WriteString(json, type.Name);
            json.Append(',');
            WriteKey(json, "full_name");
            WriteString(json, TypeFullName(type));
            json.Append(',');
            WriteKey(json, "kind");
            WriteString(json, "interface");
            json.Append(',');
            WriteKey(json, "methods");
            json.Append('[');
            for (int i = 0; i < methods.Length; i++)
            {
                if (i > 0)
                {
                    json.Append(',');
                }
                WriteMethod(json, methods[i]);
            }
            json.Append(']');
            json.Append(',');
            WriteKey(json, "properties");
            json.Append('[');
            for (int i = 0; i < properties.Length; i++)
            {
                if (i > 0)
                {
                    json.Append(',');
                }
                WriteProperty(json, properties[i]);
            }
            json.Append(']');
            json.Append(',');
            WriteKey(json, "events");
            json.Append('[');
            for (int i = 0; i < events.Length; i++)
            {
                if (i > 0)
                {
                    json.Append(',');
                }
                WriteEvent(json, events[i]);
            }
            json.Append(']');
            json.Append('}');
        }

        static MethodInfo[] FilterOrdinaryMethods(MethodInfo[] methods)
        {
            List<MethodInfo> filtered = new List<MethodInfo>();
            for (int i = 0; i < methods.Length; i++)
            {
                MethodInfo method = methods[i];
                if (method != null && !method.IsSpecialName)
                {
                    filtered.Add(method);
                }
            }
            return filtered.ToArray();
        }

        static void WriteMethod(StringBuilder json, MethodInfo method)
        {
            json.Append('{');
            WriteKey(json, "name");
            WriteString(json, method.Name);
            json.Append(',');
            WriteKey(json, "return_type");
            WriteString(json, FormatType(method.ReturnType));
            json.Append(',');
            WriteKey(json, "is_static");
            json.Append(method.IsStatic ? "true" : "false");
            json.Append(',');
            WriteKey(json, "dispid");
            WriteIntOrNull(json, GetDispId(method));
            json.Append(',');
            WriteKey(json, "parameters");
            WriteParameters(json, method.GetParameters());
            json.Append('}');
        }

        static void WriteProperty(StringBuilder json, PropertyInfo property)
        {
            MethodInfo getter = property.GetGetMethod(false);
            MethodInfo setter = property.GetSetMethod(false);
            bool isStatic = (getter != null && getter.IsStatic) || (setter != null && setter.IsStatic);
            json.Append('{');
            WriteKey(json, "name");
            WriteString(json, property.Name);
            json.Append(',');
            WriteKey(json, "type");
            WriteString(json, FormatType(property.PropertyType));
            json.Append(',');
            WriteKey(json, "can_read");
            json.Append(property.CanRead ? "true" : "false");
            json.Append(',');
            WriteKey(json, "can_write");
            json.Append(property.CanWrite ? "true" : "false");
            json.Append(',');
            WriteKey(json, "is_static");
            json.Append(isStatic ? "true" : "false");
            json.Append(',');
            WriteKey(json, "dispid");
            WriteIntOrNull(json, GetDispId(property));
            json.Append(',');
            WriteKey(json, "parameters");
            WriteParameters(json, property.GetIndexParameters());
            json.Append('}');
        }

        static void WriteEvent(StringBuilder json, EventInfo eventInfo)
        {
            MethodInfo addMethod = eventInfo.GetAddMethod(false);
            bool isStatic = addMethod != null && addMethod.IsStatic;
            json.Append('{');
            WriteKey(json, "name");
            WriteString(json, eventInfo.Name);
            json.Append(',');
            WriteKey(json, "handler_type");
            WriteString(json, FormatType(eventInfo.EventHandlerType));
            json.Append(',');
            WriteKey(json, "is_static");
            json.Append(isStatic ? "true" : "false");
            json.Append(',');
            WriteKey(json, "dispid");
            WriteIntOrNull(json, GetDispId(eventInfo));
            json.Append('}');
        }

        static void WriteParameters(StringBuilder json, ParameterInfo[] parameters)
        {
            json.Append('[');
            for (int i = 0; i < parameters.Length; i++)
            {
                if (i > 0)
                {
                    json.Append(',');
                }
                ParameterInfo parameter = parameters[i];
                json.Append('{');
                WriteKey(json, "name");
                WriteString(json, parameter.Name ?? ("param" + i.ToString(CultureInfo.InvariantCulture)));
                json.Append(',');
                WriteKey(json, "type");
                WriteString(json, FormatType(UnwrapByRef(parameter.ParameterType)));
                json.Append(',');
                WriteKey(json, "direction");
                WriteString(json, ParameterDirection(parameter));
                json.Append(',');
                WriteKey(json, "optional");
                json.Append(parameter.IsOptional ? "true" : "false");
                object defaultValue;
                if (TryPrimitiveDefault(parameter, out defaultValue))
                {
                    json.Append(',');
                    WriteKey(json, "default_value");
                    WriteLiteral(json, defaultValue);
                }
                json.Append('}');
            }
            json.Append(']');
        }

        static string ParameterDirection(ParameterInfo parameter)
        {
            if (parameter.IsOut)
            {
                return "out";
            }
            if (parameter.ParameterType.IsByRef)
            {
                return "ref";
            }
            return "in";
        }

        static bool TryPrimitiveDefault(ParameterInfo parameter, out object value)
        {
            value = null;
            if (!parameter.IsOptional || !parameter.HasDefaultValue)
            {
                return false;
            }
            object raw = parameter.DefaultValue;
            if (raw == null)
            {
                value = null;
                return true;
            }
            if (raw is DBNull || raw is Missing)
            {
                return false;
            }
            Type type = raw.GetType();
            if (type.IsEnum)
            {
                value = Convert.ToInt64(raw, CultureInfo.InvariantCulture);
                return true;
            }
            if (raw is bool || raw is string || IsNumeric(type))
            {
                value = raw;
                return true;
            }
            return false;
        }

        static bool IsNumeric(Type type)
        {
            return type == typeof(byte) ||
                type == typeof(sbyte) ||
                type == typeof(short) ||
                type == typeof(ushort) ||
                type == typeof(int) ||
                type == typeof(uint) ||
                type == typeof(long) ||
                type == typeof(ulong) ||
                type == typeof(float) ||
                type == typeof(double) ||
                type == typeof(decimal);
        }

        static int? GetDispId(MemberInfo member)
        {
            object[] attributes = member.GetCustomAttributes(typeof(DispIdAttribute), false);
            if (attributes == null || attributes.Length == 0)
            {
                return null;
            }
            return ((DispIdAttribute)attributes[0]).Value;
        }

        static Type UnwrapByRef(Type type)
        {
            if (type != null && type.IsByRef)
            {
                return type.GetElementType();
            }
            return type;
        }

        static string FormatType(Type type)
        {
            if (type == null)
            {
                return "System.Void";
            }
            if (type.IsByRef)
            {
                return FormatType(type.GetElementType());
            }
            if (type.IsArray)
            {
                return FormatType(type.GetElementType()) + "[]";
            }
            if (type.IsPointer)
            {
                return FormatType(type.GetElementType()) + "*";
            }
            string fullName = type.FullName;
            if (!string.IsNullOrEmpty(fullName))
            {
                return fullName;
            }
            return type.Name;
        }

        static string TypeFullName(Type type)
        {
            if (!string.IsNullOrEmpty(type.FullName))
            {
                return type.FullName;
            }
            if (!string.IsNullOrEmpty(type.Name))
            {
                return type.Name;
            }
            return type.ToString();
        }

        static string NormalizeGuid(string value)
        {
            string trimmed = EmptyToNull(value);
            if (trimmed == null)
            {
                return null;
            }
            if (LooksLikePath(trimmed))
            {
                return null;
            }
            try
            {
                Guid guid = new Guid(trimmed);
                return guid.ToString("B").ToUpperInvariant();
            }
            catch (FormatException)
            {
                return trimmed;
            }
            catch (OverflowException)
            {
                return trimmed;
            }
        }

        static string SanitizeMessage(string message)
        {
            if (string.IsNullOrEmpty(message))
            {
                return message ?? "";
            }
            // Replace Windows/UNC paths with the leaf name so scan JSON stays path-free.
            string result = System.Text.RegularExpressions.Regex.Replace(
                message,
                @"[A-Za-z]:\\(?:[^\\/:*?""<>|\r\n]+\\)*([^\\/:*?""<>|\r\n]+)",
                "$1");
            result = System.Text.RegularExpressions.Regex.Replace(
                result,
                @"\\\\[^\\/:*?""<>|\r\n]+\\(?:[^\\/:*?""<>|\r\n]+\\)*([^\\/:*?""<>|\r\n]+)",
                "$1");
            return result;
        }

        static bool LooksLikePath(string value)
        {
            if (value.Length >= 3 && char.IsLetter(value[0]) && value[1] == ':' && (value[2] == '\\' || value[2] == '/'))
            {
                return true;
            }
            return value.StartsWith("\\\\", StringComparison.Ordinal);
        }

        static string EmptyToNull(string value)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                return null;
            }
            return value.Trim();
        }

        static int CompareTypes(Type left, Type right)
        {
            return string.CompareOrdinal(TypeFullName(left), TypeFullName(right));
        }

        static int CompareMethods(MethodInfo left, MethodInfo right)
        {
            int name = string.CompareOrdinal(left.Name, right.Name);
            if (name != 0)
            {
                return name;
            }
            return string.CompareOrdinal(MethodSortKey(left), MethodSortKey(right));
        }

        static string MethodSortKey(MethodInfo method)
        {
            StringBuilder key = new StringBuilder();
            key.Append(FormatType(method.ReturnType));
            key.Append(' ');
            key.Append(method.Name);
            key.Append('(');
            ParameterInfo[] parameters = method.GetParameters();
            for (int i = 0; i < parameters.Length; i++)
            {
                if (i > 0)
                {
                    key.Append(',');
                }
                key.Append(ParameterDirection(parameters[i]));
                key.Append(' ');
                key.Append(FormatType(UnwrapByRef(parameters[i].ParameterType)));
            }
            key.Append(')');
            return key.ToString();
        }

        static int CompareProperties(PropertyInfo left, PropertyInfo right)
        {
            return string.CompareOrdinal(left.Name, right.Name);
        }

        static int CompareEvents(EventInfo left, EventInfo right)
        {
            return string.CompareOrdinal(left.Name, right.Name);
        }

        static void WriteRawObjectArray(StringBuilder json, IList<string> objects)
        {
            json.Append('[');
            if (objects != null)
            {
                for (int i = 0; i < objects.Count; i++)
                {
                    if (i > 0)
                    {
                        json.Append(',');
                    }
                    string item = objects[i];
                    json.Append(string.IsNullOrEmpty(item) ? "null" : item);
                }
            }
            json.Append(']');
        }

        static void WriteStringArray(StringBuilder json, IList<string> values)
        {
            json.Append('[');
            if (values != null)
            {
                for (int i = 0; i < values.Count; i++)
                {
                    if (i > 0)
                    {
                        json.Append(',');
                    }
                    WriteString(json, values[i]);
                }
            }
            json.Append(']');
        }

        static void WriteKey(StringBuilder json, string name)
        {
            WriteString(json, name);
            json.Append(':');
        }

        static void WriteStringOrNull(StringBuilder json, string value)
        {
            if (value == null)
            {
                json.Append("null");
            }
            else
            {
                WriteString(json, value);
            }
        }

        static void WriteIntOrNull(StringBuilder json, int? value)
        {
            if (value.HasValue)
            {
                json.Append(value.Value.ToString(CultureInfo.InvariantCulture));
            }
            else
            {
                json.Append("null");
            }
        }

        static void WriteLiteral(StringBuilder json, object value)
        {
            if (value == null)
            {
                json.Append("null");
                return;
            }
            if (value is bool)
            {
                json.Append((bool)value ? "true" : "false");
                return;
            }
            if (value is string)
            {
                WriteString(json, (string)value);
                return;
            }
            if (value is IFormattable)
            {
                json.Append(((IFormattable)value).ToString(null, CultureInfo.InvariantCulture));
                return;
            }
            WriteString(json, Convert.ToString(value, CultureInfo.InvariantCulture));
        }

        static void WriteString(StringBuilder json, string value)
        {
            json.Append('"');
            if (value != null)
            {
                for (int i = 0; i < value.Length; i++)
                {
                    char c = value[i];
                    switch (c)
                    {
                        case '"':
                            json.Append("\\\"");
                            break;
                        case '\\':
                            json.Append("\\\\");
                            break;
                        case '\b':
                            json.Append("\\b");
                            break;
                        case '\f':
                            json.Append("\\f");
                            break;
                        case '\n':
                            json.Append("\\n");
                            break;
                        case '\r':
                            json.Append("\\r");
                            break;
                        case '\t':
                            json.Append("\\t");
                            break;
                        default:
                            if (c < 0x20)
                            {
                                json.Append("\\u");
                                json.Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                            }
                            else
                            {
                                json.Append(c);
                            }
                            break;
                    }
                }
            }
            json.Append('"');
        }
    }
}
