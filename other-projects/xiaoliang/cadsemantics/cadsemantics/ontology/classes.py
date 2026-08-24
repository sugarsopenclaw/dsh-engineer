DOCUMENTATION_CLASSES = (
    "documentation.Sheet",
    "documentation.SheetBoundary",
    "documentation.TitleBlock",
    "documentation.DrawingView",
    "documentation.Legend",
    "documentation.Schedule",
    "documentation.NoteBlock",
    "documentation.DetailReference",
    "documentation.SectionReference",
)

GENERIC_ENGINEERING_CLASSES = (
    "generic.EnclosedSpace",
    "generic.SymbolicComponent",
    "generic.DistributionNetwork",
    "generic.NetworkPort",
    "generic.NetworkJunction",
    "generic.ScheduleRecord",
    "generic.TagLabel",
    "generic.GenericAssembly",
)

BUILTIN_CLASS_IDS = tuple(sorted((*DOCUMENTATION_CLASSES, *GENERIC_ENGINEERING_CLASSES)))

