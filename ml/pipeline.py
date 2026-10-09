"""Full refresh: download data, train a new model version, export the site data.

    python -m ml.pipeline            # everything
    python -m ml.pipeline --no-train # reuse the latest registered model
"""
from __future__ import annotations

import sys

from ml.data.download import download
from ml.export_site import export
from ml.training.train_match_result import train

if __name__ == "__main__":
    download()
    if "--no-train" not in sys.argv:
        train()
    export()
