from cadsemantics.ontology.definitions import UnitDefinition


BUILTIN_UNIT_DEFINITIONS = (
    UnitDefinition("unit.millimetre", "mm", "length", "mm", 1.0, ("millimeter", "millimetre")),
    UnitDefinition("unit.centimetre", "cm", "length", "mm", 10.0, ("centimeter", "centimetre")),
    UnitDefinition("unit.metre", "m", "length", "mm", 1000.0, ("meter", "metre")),
    UnitDefinition("unit.inch", "in", "length", "mm", 25.4, ('"', "inch")),
    UnitDefinition("unit.foot", "ft", "length", "mm", 304.8, ("foot", "feet")),
    UnitDefinition("unit.volt", "V", "voltage", "V", 1.0, ("v",)),
    UnitDefinition("unit.kilovolt", "kV", "voltage", "V", 1000.0, ("kv",)),
    UnitDefinition("unit.volt_ampere", "VA", "apparent_power", "VA", 1.0, ("va",)),
    UnitDefinition("unit.kilovolt_ampere", "kVA", "apparent_power", "VA", 1000.0, ("kva",)),
)

