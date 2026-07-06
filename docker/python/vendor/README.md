Place vendor-provided Linux packages for iFinD here when you need full iFinD support in Docker.

Supported package formats:

- `*.whl`
- `*.tar.gz`
- `*.zip`
- unpacked `iFinDPy.py`
- unpacked `iFinDAPI/`

The Docker build copies this directory into the image and installs any matching package files.
It also supports copying an existing local SDK layout directly into the image when you place
`iFinDPy.py` and `iFinDAPI/` here.

If this directory only contains this README, the Python service still builds and falls back to
AkShare when iFinD is unavailable.
