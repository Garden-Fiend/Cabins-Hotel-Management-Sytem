"""Run the existing owned-company harness with the B7 original-control scenario."""

import os
import runpy
from pathlib import Path

os.environ["HMS_VERIFY_COLLECTIONS"] = "1"
runpy.run_path(str(Path(__file__).with_name("run-booking-financials.py")), run_name="__main__")
