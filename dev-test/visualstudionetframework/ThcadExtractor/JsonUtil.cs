using System;
using System.Collections;
using System.Globalization;
using System.Text;

namespace Shb.Thcad.Extractor
{
    internal static class JsonUtil
    {
        public static string Serialize(object value)
        {
            var sb = new StringBuilder(256);
            Write(sb, value);
            return sb.ToString();
        }

        static void Write(StringBuilder sb, object value)
        {
            if (value == null)
            {
                sb.Append("null");
                return;
            }

            if (value is string s)
            {
                WriteString(sb, s);
                return;
            }

            if (value is bool b)
            {
                sb.Append(b ? "true" : "false");
                return;
            }

            if (value is byte[] bytes)
            {
                WriteString(sb, Hex(bytes));
                return;
            }

            if (value is IDictionary dict)
            {
                sb.Append('{');
                bool first = true;
                foreach (DictionaryEntry entry in dict)
                {
                    if (entry.Value == null)
                    {
                        continue;
                    }

                    if (!first)
                    {
                        sb.Append(',');
                    }

                    first = false;
                    WriteString(sb, Convert.ToString(entry.Key, CultureInfo.InvariantCulture) ?? "");
                    sb.Append(':');
                    Write(sb, entry.Value);
                }

                sb.Append('}');
                return;
            }

            if (value is IEnumerable list && !(value is string))
            {
                sb.Append('[');
                bool first = true;
                foreach (object item in list)
                {
                    if (!first)
                    {
                        sb.Append(',');
                    }

                    first = false;
                    Write(sb, item);
                }

                sb.Append(']');
                return;
            }

            if (value is sbyte || value is byte || value is short || value is ushort
                || value is int || value is uint || value is long || value is ulong)
            {
                sb.Append(Convert.ToString(value, CultureInfo.InvariantCulture));
                return;
            }

            if (value is float || value is double || value is decimal)
            {
                double number = Convert.ToDouble(value, CultureInfo.InvariantCulture);
                if (double.IsNaN(number) || double.IsInfinity(number))
                {
                    sb.Append("null");
                    return;
                }

                sb.Append(number.ToString("G17", CultureInfo.InvariantCulture));
                return;
            }

            if (value is DateTime dt)
            {
                WriteString(sb, dt.ToUniversalTime().ToString("o"));
                return;
            }

            WriteString(sb, Convert.ToString(value, CultureInfo.InvariantCulture) ?? "");
        }

        static void WriteString(StringBuilder sb, string value)
        {
            sb.Append('"');
            foreach (char c in value)
            {
                switch (c)
                {
                    case '"':
                        sb.Append("\\\"");
                        break;
                    case '\\':
                        sb.Append("\\\\");
                        break;
                    case '\n':
                        sb.Append("\\n");
                        break;
                    case '\r':
                        sb.Append("\\r");
                        break;
                    case '\t':
                        sb.Append("\\t");
                        break;
                    default:
                        if (c < 0x20)
                        {
                            sb.Append("\\u");
                            sb.Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        }
                        else
                        {
                            sb.Append(c);
                        }

                        break;
                }
            }

            sb.Append('"');
        }

        static string Hex(byte[] bytes)
        {
            if (bytes == null || bytes.Length == 0)
            {
                return "";
            }

            var sb = new StringBuilder(bytes.Length * 2);
            foreach (byte item in bytes)
            {
                sb.Append(item.ToString("X2", CultureInfo.InvariantCulture));
            }

            return sb.ToString();
        }
    }
}
