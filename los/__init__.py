"""Knowledge OS: a local site for exploring the vault's disciplines and studying its learning road.

The road's code stays in the vault (x/scripts/_road*.py); this package imports it, caches its reads, and serves the
pages. It writes verdicts only through the road's own writer, and its own ledgers under x/reports/learning/los/.
"""

VERSION = "0.9.0"
