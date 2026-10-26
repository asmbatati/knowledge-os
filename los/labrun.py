"""Runs one piece of the Lab's Python, read from stdin, in a fresh interpreter the server starts and stops.

Its output is the program's own. When the program drew with matplotlib, its figures follow at the very end, after a
marker line, as PNG pictures in base64: the server splits them off. The Agg backend draws without a window, so
`plt.show()` is harmless here.
"""
import os
import sys

MARK = "\x1eLOSFIGS\x1e"
MAX_FIGURES = 6


def main() -> int:
    os.environ.setdefault("MPLBACKEND", "Agg")
    import warnings
    warnings.filterwarnings("ignore", message=".*non-interactive.*")
    code = sys.stdin.read()
    status = 0
    try:
        exec(compile(code, "<lab>", "exec"), {"__name__": "__main__"})
    except SystemExit as e:
        status = e.code if isinstance(e.code, int) else (0 if e.code is None else 1)
    except BaseException:
        import traceback
        traceback.print_exc()
        status = 1
    if "matplotlib.pyplot" in sys.modules:
        try:
            import base64
            import io
            import json
            import matplotlib.pyplot as plt
            figures = []
            for n in plt.get_fignums()[:MAX_FIGURES]:
                buf = io.BytesIO()
                plt.figure(n).savefig(buf, format="png", dpi=110, bbox_inches="tight")
                figures.append(base64.b64encode(buf.getvalue()).decode("ascii"))
            if figures:
                sys.stdout.flush()
                sys.stdout.write("\n" + MARK + json.dumps(figures))
        except Exception:
            import traceback
            traceback.print_exc()
    sys.stdout.flush()
    return status


if __name__ == "__main__":
    sys.exit(main())
