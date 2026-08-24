# Third-party notices

The `cadkernel` CLI uses the following pinned runtime dependencies:

- ezdxf (MIT)
- fontTools (MIT; transitive through ezdxf)
- pyparsing (MIT; transitive through ezdxf)
- typing_extensions (PSF-2.0; transitive through ezdxf)
- NumPy (BSD-3-Clause)
- NetworkX (BSD-3-Clause)
- Shapely (BSD-3-Clause), dynamically linked by its wheel to GEOS (LGPL-2.1-or-later)

The exact resolved versions are recorded in `uv.lock`. Binary distribution must include
the license texts shipped with the resolved wheels, including licenses for libraries
bundled by NumPy, and the GEOS LGPL source/linking notice. This source-tree inventory is
not by itself a substitute for the release artifact's complete notice bundle.
