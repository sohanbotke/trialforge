from __future__ import annotations

import unittest
from unittest.mock import patch
from urllib.error import URLError

from collector import (
    cap_submission_score,
    classify_landing_page,
    extract_candidates,
    parse_bool,
    source_confidence,
    validate_public_url,
)


class CollectorSafetyTest(unittest.TestCase):
    def test_validate_public_url_rejects_local_or_private_targets(self) -> None:
        blocked = [
            "file:///etc/passwd",
            "http://localhost:8000",
            "http://127.0.0.1:8000",
            "http://10.0.0.1",
            "http://100.64.0.1",
            "http://169.254.169.254",
        ]
        for url in blocked:
            with self.subTest(url=url), self.assertRaises(URLError):
                validate_public_url(url)

    def test_classify_landing_page_detects_trial_signal(self) -> None:
        page = "<html><body>Start your free trial today. Intro pricing ends soon.</body></html>"
        self.assertEqual(classify_landing_page(page), "trial-page")

    def test_extract_candidates_uses_direct_link_when_present(self) -> None:
        source = {
            "id": "demo-source",
            "type": "official",
            "label": "Demo",
            "url": "https://example.com/pricing",
            "categories": ["shows"],
            "verify_links": False,
        }
        html = """
        <html><body>
          <a href="/trial">Start free trial</a>
          <p>Generic page copy with no offer.</p>
        </body></html>
        """
        with patch("collector.validate_public_url"):
            candidates = extract_candidates(source, html)
        self.assertEqual(candidates[0].url, "https://example.com/trial")
        self.assertEqual(candidates[0].link_status, "not_checked")
        self.assertEqual(candidates[0].landing_match, "not_checked")

    def test_extract_candidates_rejects_private_link_even_when_not_checked(self) -> None:
        source = {
            "id": "demo-source",
            "type": "rss",
            "label": "Demo",
            "url": "https://example.com/feed",
            "categories": ["shows"],
            "verify_links": False,
        }
        html = '<a href="http://127.0.0.1:8000/admin">Start free trial</a>'
        self.assertEqual(extract_candidates(source, html), [])

    def test_source_confidence_does_not_overtrust_off_domain_official_links(self) -> None:
        source = {
            "type": "official",
            "url": "https://example.com/pricing",
        }
        self.assertEqual(source_confidence(source, "https://promo.example.net/trial"), "candidate")

    def test_string_false_is_not_verified(self) -> None:
        self.assertFalse(parse_bool("false"))
        self.assertFalse(parse_bool(""))
        self.assertTrue(parse_bool("true"))

    def test_unverified_submission_score_is_capped(self) -> None:
        self.assertEqual(cap_submission_score(999, verified=False), 55)
        self.assertEqual(cap_submission_score(999, verified=True), 90)


if __name__ == "__main__":
    unittest.main()


class CollectorExtractionTest(unittest.TestCase):
    def test_parse_robots_honors_disallow_and_crawl_delay(self) -> None:
        from collector import parse_robots
        rules, delay = parse_robots(
            "User-agent: *\nDisallow: /search\nCrawl-delay: 7\n")
        self.assertIn(("/search", "disallow"), rules)
        self.assertEqual(delay, 7.0)

    def test_parse_robots_ignores_other_agents(self) -> None:
        from collector import parse_robots
        rules, _ = parse_robots(
            "User-agent: SomeOtherBot\nDisallow: /\n")
        self.assertEqual(rules, [])

    def test_parse_robots_groups_do_not_leak(self) -> None:
        from collector import parse_robots
        rules, _ = parse_robots(
            "User-agent: *\nDisallow: /search\n\n"
            "User-agent: BadBot\nDisallow: /\n")
        self.assertEqual(rules, [("/search", "disallow")])

    def test_decode_chunked(self) -> None:
        from collector import decode_chunked
        body = b"4\r\nWiki\r\n5\r\npedia\r\n0\r\n\r\n"
        self.assertEqual(decode_chunked(body), b"Wikipedia")

    def test_parse_feed_items_rss(self) -> None:
        from collector import parse_feed_items
        feed = """<?xml version="1.0"?>
        <rss version="2.0"><channel><title>T</title>
        <item><title>Start your free trial of Foo</title>
        <link>https://example.com/foo</link>
        <description>Try Foo free for 30 days.</description>
        <pubDate>Mon, 01 Jan 2024 00:00:00 GMT</pubDate></item>
        </channel></rss>"""
        items = parse_feed_items(feed)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["title"], "Start your free trial of Foo")
        self.assertEqual(items[0]["link"], "https://example.com/foo")
        self.assertIn("30 days", items[0]["summary"])

    def test_parse_feed_items_atom(self) -> None:
        from collector import parse_feed_items
        feed = """<feed xmlns="http://www.w3.org/2005/Atom">
        <entry><title>Bar intro offer</title>
        <link href="https://example.com/bar"/>
        <summary>First month free.</summary>
        <published>2024-01-01T00:00:00Z</published></entry></feed>"""
        items = parse_feed_items(feed)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["link"], "https://example.com/bar")

    def test_strip_boilerplate_removes_nav(self) -> None:
        from collector import strip_boilerplate
        html = ("<nav>Start your free trial now</nav>"
                "<main><p>Real offer copy here.</p></main>")
        cleaned = strip_boilerplate(html)
        self.assertNotIn("nav", cleaned)
        self.assertIn("Real offer copy", cleaned)

    def test_negative_signals_penalize_score(self) -> None:
        from collector import score_candidate
        source = {"type": "official", "url": "https://example.com/pricing"}
        good = score_candidate(source, "https://example.com/trial",
                               ["free trial"], [])
        bad = score_candidate(source, "https://example.com/trial",
                              ["free trial"], ["offer expired"])
        self.assertGreater(good, bad)

    def test_overlapping_signal_phrases_deduped(self) -> None:
        from collector import matched_signals
        hits = matched_signals("Start your free trial today!")
        self.assertEqual(hits, ["start your free trial"])

    def test_extract_trial_days(self) -> None:
        from collector import extract_trial_days
        self.assertEqual(extract_trial_days("Enjoy a 30-day free trial."), 30)
        self.assertEqual(extract_trial_days("Free for 3 months, then paid."), 90)
        self.assertIsNone(extract_trial_days("No trial mentioned here."))

    def test_extract_price_hint(self) -> None:
        from collector import extract_price_hint
        self.assertEqual(extract_price_hint("Then $9.99/month after trial."),
                         "$9.99/mo")
        self.assertIsNone(extract_price_hint("Completely free forever."))

    def test_canonical_url_drops_trackers(self) -> None:
        from collector import canonical_url
        url = canonical_url(
            "https://Example.com/offer?utm_source=x&plan=annual#frag")
        self.assertEqual(url, "https://example.com/offer?plan=annual")

    def test_score_candidate_clamped(self) -> None:
        from collector import score_candidate
        source = {"type": "official", "url": "https://example.com/"}
        many = ["free trial", "intro offer", "promo code", "cancel anytime",
                "money-back guarantee", "no credit card required"]
        score = score_candidate(source, "https://example.com/trial", many, [],
                                landing_match="trial-page")
        self.assertLessEqual(score, 100)
        self.assertGreaterEqual(
            score_candidate(source, "https://example.com/t", [], ["expired"] * 3), 0)

    def test_classify_fetch_quality_js_shell(self) -> None:
        from collector import classify_fetch_quality
        html = ('<html><head><script src="/app.js"></script></head>'
                '<body><div id="root"></div>'
                '<p>Please enable JavaScript to continue.</p></body></html>')
        self.assertEqual(classify_fetch_quality(html, "text/html"), "js_required")

    def test_extract_candidates_from_feed(self) -> None:
        from unittest.mock import patch
        from collector import extract_candidates
        source = {"id": "demo", "type": "rss", "label": "Demo feed",
                  "url": "https://example.com/feed", "categories": ["shows"],
                  "verify_links": False}
        feed = """<?xml version="1.0"?>
        <rss version="2.0"><channel>
        <item><title>Start your free trial of FooTV, 30-day free trial</title>
        <link>https://example.com/footv</link>
        <description>Then $7.99/month. New customers only.</description>
        </item></channel></rss>"""
        with patch("collector.validate_public_url"):
            candidates = extract_candidates(source, feed)
        self.assertEqual(len(candidates), 1)
        self.assertEqual(candidates[0].url, "https://example.com/footv")
        self.assertEqual(candidates[0].trial_days, 30)
        self.assertEqual(candidates[0].price_hint, "$7.99/mo")
        self.assertEqual(candidates[0].eligibility_hint, "new customers")

    def test_extract_candidates_structured_fields_from_html(self) -> None:
        from unittest.mock import patch
        from collector import extract_candidates
        source = {"id": "demo", "type": "official", "label": "Demo",
                  "url": "https://example.com/pricing", "categories": ["shows"],
                  "verify_links": False}
        html = ('<html><body><main>'
                '<a href="/trial">Start your free trial — 14-day free trial, '
                'then $12.99/month</a>'
                '</main></body></html>')
        with patch("collector.validate_public_url"):
            candidates = extract_candidates(source, html)
        self.assertTrue(candidates)
        self.assertEqual(candidates[0].trial_days, 14)
        self.assertEqual(candidates[0].price_hint, "$12.99/mo")


class CollectorStateTest(unittest.TestCase):
    def _candidate(self, **overrides):
        from collector import TrialCandidate
        base = dict(source_id="s", source_label="S", source_type="official",
                    title="Offer", url="https://example.com/offer",
                    source_url="https://example.com/", categories=[],
                    confidence="high", score=80, signals=["free trial"],
                    link_status="not_checked", landing_match="not_checked",
                    trial_days=30, price_hint="$9.99/mo")
        base.update(overrides)
        return TrialCandidate(**base)

    def test_apply_state_marks_new_updated_unchanged(self) -> None:
        from collector import apply_state
        now = "2026-09-24T00:00:00+00:00"
        state: dict = {"version": 1, "sources": {}, "candidates": {}}
        first = apply_state([self._candidate()], state, {"s"}, now)
        self.assertEqual(first[0].status, "new")
        second = apply_state([self._candidate()], state, {"s"}, now)
        self.assertEqual(second[0].status, "unchanged")
        changed = apply_state(
            [self._candidate(price_hint="$19.99/mo")], state, {"s"}, now)
        self.assertEqual(changed[0].status, "updated")
        # first_seen is stable across runs
        self.assertEqual(changed[0].first_seen, first[0].first_seen)

    def test_apply_state_marks_gone(self) -> None:
        from collector import apply_state
        now = "2026-09-24T00:00:00+00:00"
        state: dict = {"version": 1, "sources": {}, "candidates": {}}
        apply_state([self._candidate()], state, {"s"}, now)
        # Source fetched fine this run but the candidate vanished.
        result = apply_state([], state, {"s"}, now)
        gone = [c for c in result if c.status == "gone"]
        self.assertEqual(len(gone), 1)
        self.assertEqual(gone[0].url, "https://example.com/offer")

    def test_apply_state_no_gone_when_source_failed(self) -> None:
        from collector import apply_state
        now = "2026-09-24T00:00:00+00:00"
        state: dict = {"version": 1, "sources": {}, "candidates": {}}
        apply_state([self._candidate()], state, {"s"}, now)
        # Source failed this run -> not in fetched set -> no false "gone".
        result = apply_state([], state, set(), now)
        self.assertEqual([c for c in result if c.status == "gone"], [])
