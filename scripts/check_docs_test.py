"""Regression cases for the docs gate: each defect in a minimal valid tree is reported."""
import pathlib
import sys
import tempfile
import unittest

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from check_docs import anchors, findings  # noqa: E402

SHA = "0" * 64
RFC = """# RFC-0001: Do a thing

- Status: Accepted
- Authors: @someone
- Created: 2026-11-26
- Target milestone: M1

""" + "\n".join(f"## {name}\n\nText.\n" for name in [
    "Summary", "Motivation", "Goals", "Non-Goals", "Proposed Design", "Alternatives Considered", "Drawbacks",
    "Migration / Rollout", "Testing Strategy", "Open Questions", "References"])
TREE = {
    "upstream.lock": f"FLASHPROVE_REPO=x\nFLASHPROVE_COMMIT={SHA}\nFLASHPROVE_VERSION=1\n",
    "toolchain.lock": f"WASI_SDK_VERSION=1\nWASMTIME_VERSION=1\nNODE_MAJOR=24\nWASI_SDK_SHA256_X={SHA}\n",
    "SPEC.md": "# Spec\n\n**R-EQ-1** A rule.\n\n## 8. Milestones\n\n| Stage | Gate |\n|---|---|\n"
               "| M0 Ground | a |\n| M1 One stage | b |\n\n## Same\n\n## Same\n",
    "README.md": "See [milestones](SPEC.md#8-milestones), [twice](SPEC.md#same-1), [RFC](docs/rfcs/RFC-0001-thing.md#summary), "
                 "[top](#readme) and ADR 0001 for R-EQ-1.\n\n# Readme\n\n```\n[not a link](missing.md#nowhere)\n```\n",
    "docs/rfcs/RFC-0001-thing.md": RFC,
    "docs/adr/0001-a-choice.md": "# 0001. A choice\n\nStatus: accepted, 2026-11-26\n\nBody.\n",
    "docs/roadmap/IMPLEMENTATION.md": "# Tracker\n\n## M0 Ground\n\n## M1 One stage\n",
}


class DocsGate(unittest.TestCase):
    def run_tree(self, **changes):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for name, text in {**TREE, **changes}.items():
                if text is None:
                    continue
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text)
            return findings(root)[0]

    def assertFinding(self, fragment, **changes):
        bad = self.run_tree(**changes)
        self.assertTrue(any(fragment in finding for finding in bad), f"{fragment!r} not in {bad}")

    def test_valid_tree_is_clean(self):
        self.assertEqual(self.run_tree(), [])

    def test_bad_anchor(self):
        self.assertFinding("no heading for anchor SPEC.md#9-milestones",
                           **{"README.md": TREE["README.md"].replace("#8-milestones", "#9-milestones")})
        self.assertFinding("no heading for anchor #nowhere", **{"README.md": "[x](#nowhere)\n"})

    def test_broken_link(self):
        self.assertFinding("broken link missing.md", **{"README.md": "[x](missing.md)\n"})

    def test_missing_rfc_metadata(self):
        self.assertFinding("missing or unknown RFC Status",
                           **{"docs/rfcs/RFC-0001-thing.md": RFC.replace("- Status: Accepted\n", "")})
        self.assertFinding("missing RFC Authors",
                           **{"docs/rfcs/RFC-0001-thing.md": RFC.replace("- Authors: @someone\n", "")})
        self.assertFinding("malformed RFC Created",
                           **{"docs/rfcs/RFC-0001-thing.md": RFC.replace("2026-11-26", "yesterday")})
        self.assertFinding("RFC sections must be",
                           **{"docs/rfcs/RFC-0001-thing.md": RFC.replace("## Drawbacks", "## Risks")})
        self.assertFinding("title must be '# RFC-NNNN",
                           **{"docs/rfcs/RFC-0001-thing.md": RFC.replace("RFC-0001:", "RFC-0002:")})

    def test_unknown_milestone(self):
        self.assertFinding("unknown milestone M9",
                           **{"docs/rfcs/RFC-0001-thing.md": RFC.replace("Target milestone: M1", "Target milestone: M1, M9")})
        self.assertFinding("unknown milestone M7",
                           **{"docs/roadmap/IMPLEMENTATION.md": TREE["docs/roadmap/IMPLEMENTATION.md"] + "\n## M7 Later\n"})

    def test_adr_references_and_metadata(self):
        self.assertFinding("ADR 0002 does not exist", **{"README.md": "See ADR 0002.\n"})
        self.assertFinding("missing ADR Status", **{"docs/adr/0001-a-choice.md": "# 0001. A choice\n\nBody.\n"})
        self.assertFinding("title must be '# NNNN.", **{"docs/adr/0001-a-choice.md": "# 1. A choice\n\nStatus: accepted\n"})

    def test_requirements_dashes_and_locks(self):
        self.assertFinding("R-EQ-9 is not defined", **{"README.md": "R-EQ-9\n"})
        self.assertFinding("em or en dash", **{"README.md": "a — b\n"})
        self.assertFinding("missing FLASHPROVE_COMMIT", **{"upstream.lock": "FLASHPROVE_REPO=x\nFLASHPROVE_VERSION=1\n"})

    def test_slugs_follow_github(self):
        text = "# The `fpv` CLI: v1.0!\n\n## [Linked](x.md) heading\n\n## Same\n\n## Same\n\n```\n# not a heading\n```\n"
        self.assertEqual(anchors(text), {"the-fpv-cli-v10", "linked-heading", "same", "same-1"})


if __name__ == "__main__":
    unittest.main()
