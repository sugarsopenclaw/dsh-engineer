using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace Shb.Thcad.Probes
{
    public sealed class PeExport
    {
        public string Name { get; set; }
        public uint Ordinal { get; set; }
        public uint RelativeVirtualAddress { get; set; }
        public string Forwarder { get; set; }
    }

    public sealed class PeExportInventory
    {
        public string Path { get; set; }
        public ushort Machine { get; set; }
        public bool IsPe32Plus { get; set; }
        public string ExportingModuleName { get; set; }
        public IList<PeExport> Exports { get; set; }
    }

    public static class PeExportReader
    {
        sealed class Section
        {
            public uint VirtualAddress;
            public uint VirtualSize;
            public uint RawSize;
            public uint RawOffset;
        }

        public static PeExportInventory Read(string path)
        {
            if (path == null)
            {
                throw new ArgumentNullException("path");
            }

            using (var stream = File.Open(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite))
            using (var reader = new BinaryReader(stream, Encoding.ASCII, true))
            {
                if (reader.ReadUInt16() != 0x5A4D)
                {
                    throw new InvalidDataException("Not an MZ executable: " + path);
                }

                stream.Position = 0x3C;
                uint peOffset = reader.ReadUInt32();
                stream.Position = peOffset;
                if (reader.ReadUInt32() != 0x00004550)
                {
                    throw new InvalidDataException("Missing PE signature: " + path);
                }

                ushort machine = reader.ReadUInt16();
                ushort sectionCount = reader.ReadUInt16();
                stream.Position += 12;
                ushort optionalHeaderSize = reader.ReadUInt16();
                stream.Position += 2;

                long optionalHeaderOffset = stream.Position;
                ushort magic = reader.ReadUInt16();
                bool isPe32Plus;
                int dataDirectoryOffset;
                if (magic == 0x20B)
                {
                    isPe32Plus = true;
                    dataDirectoryOffset = 112;
                }
                else if (magic == 0x10B)
                {
                    isPe32Plus = false;
                    dataDirectoryOffset = 96;
                }
                else
                {
                    throw new InvalidDataException("Unknown PE optional-header magic: " + magic);
                }

                stream.Position = optionalHeaderOffset + dataDirectoryOffset;
                uint exportRva = reader.ReadUInt32();
                uint exportSize = reader.ReadUInt32();

                stream.Position = optionalHeaderOffset + optionalHeaderSize;
                var sections = new List<Section>();
                for (int index = 0; index < sectionCount; index++)
                {
                    stream.Position += 8;
                    var section = new Section();
                    section.VirtualSize = reader.ReadUInt32();
                    section.VirtualAddress = reader.ReadUInt32();
                    section.RawSize = reader.ReadUInt32();
                    section.RawOffset = reader.ReadUInt32();
                    stream.Position += 16;
                    sections.Add(section);
                }

                var result = new PeExportInventory
                {
                    Path = System.IO.Path.GetFullPath(path),
                    Machine = machine,
                    IsPe32Plus = isPe32Plus,
                    ExportingModuleName = "",
                    Exports = new List<PeExport>()
                };
                if (exportRva == 0 || exportSize == 0)
                {
                    return result;
                }

                stream.Position = RvaToOffset(exportRva, sections);
                stream.Position += 12;
                uint moduleNameRva = reader.ReadUInt32();
                uint ordinalBase = reader.ReadUInt32();
                uint functionCount = reader.ReadUInt32();
                uint nameCount = reader.ReadUInt32();
                uint functionsRva = reader.ReadUInt32();
                uint namesRva = reader.ReadUInt32();
                uint ordinalsRva = reader.ReadUInt32();

                result.ExportingModuleName = ReadAsciiZ(reader, RvaToOffset(moduleNameRva, sections));

                var namesByFunctionIndex = new Dictionary<uint, string>();
                for (uint index = 0; index < nameCount; index++)
                {
                    stream.Position = RvaToOffset(namesRva, sections) + index * 4;
                    uint nameRva = reader.ReadUInt32();
                    stream.Position = RvaToOffset(ordinalsRva, sections) + index * 2;
                    uint functionIndex = reader.ReadUInt16();
                    namesByFunctionIndex[functionIndex] =
                        ReadAsciiZ(reader, RvaToOffset(nameRva, sections));
                }

                for (uint functionIndex = 0; functionIndex < functionCount; functionIndex++)
                {
                    stream.Position = RvaToOffset(functionsRva, sections) + functionIndex * 4;
                    uint functionRva = reader.ReadUInt32();
                    if (functionRva == 0)
                    {
                        continue;
                    }

                    string name;
                    namesByFunctionIndex.TryGetValue(functionIndex, out name);
                    string forwarder = "";
                    if (functionRva >= exportRva && functionRva < exportRva + exportSize)
                    {
                        forwarder = ReadAsciiZ(reader, RvaToOffset(functionRva, sections));
                    }

                    result.Exports.Add(new PeExport
                    {
                        Name = name ?? "",
                        Ordinal = ordinalBase + functionIndex,
                        RelativeVirtualAddress = functionRva,
                        Forwarder = forwarder
                    });
                }

                return result;
            }
        }

        static long RvaToOffset(uint rva, IList<Section> sections)
        {
            foreach (Section section in sections)
            {
                uint span = Math.Max(section.VirtualSize, section.RawSize);
                if (rva >= section.VirtualAddress && rva < section.VirtualAddress + span)
                {
                    return section.RawOffset + (rva - section.VirtualAddress);
                }
            }

            // Header RVAs are file offsets in ordinary PE images.
            return rva;
        }

        static string ReadAsciiZ(BinaryReader reader, long offset)
        {
            reader.BaseStream.Position = offset;
            var bytes = new List<byte>();
            byte value;
            while ((value = reader.ReadByte()) != 0)
            {
                bytes.Add(value);
            }
            return Encoding.ASCII.GetString(bytes.ToArray());
        }
    }
}
