from cadsemantics.contracts import PropertyScope
from cadsemantics.ontology.definitions import PropertyDefinition


BUILTIN_PROPERTY_DEFINITIONS = (
    PropertyDefinition(
        "core.label_text",
        "string",
        None,
        None,
        "0..*",
        (),
        (PropertyScope.REPRESENTATION,),
    ),
    PropertyDefinition(
        "core.row_count",
        "integer",
        "dimensionless",
        None,
        "0..1",
        ("documentation.Schedule", "documentation.TitleBlock", "generic.ScheduleRecord"),
        (PropertyScope.REPRESENTATION,),
    ),
    PropertyDefinition(
        "core.column_count",
        "integer",
        "dimensionless",
        None,
        "0..1",
        ("documentation.Schedule", "documentation.TitleBlock", "generic.ScheduleRecord"),
        (PropertyScope.REPRESENTATION,),
    ),
    PropertyDefinition(
        "core.measured_value",
        "decimal",
        "drawing_length",
        None,
        "0..*",
        (),
        (PropertyScope.REPRESENTATION,),
    ),
)
