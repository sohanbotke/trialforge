import unittest
from datetime import datetime
from unittest.mock import patch
from nightly import Fetcher, candidate, checked_url, collect, is_due, review_report

SOURCE = {
    'id': 'demo', 'label': 'Demo', 'url': 'https://example.com/pricing',
    'offer_url': 'https://example.com/pricing', 'format': 'markdown',
    'allowed_hosts': ['example.com'], 'categories': ['devtools'],
    'license': 'CC-BY-4.0', 'attribution': 'Example',
    'policy_url': 'https://example.com/policy', 'policy_reviewed': '2026-09-08', 'enabled': True,
}
NOW = '2026-09-08T12:00:00+00:00'


class NightlyTest(unittest.TestCase):
    def test_allowlist_rejects_unsafe_urls(self):
        for url in ['http://example.com/', 'https://other.test/', 'https://a:b@example.com/', 'https://example.com:123/', 'https://example.com/\r\nX:bad']:
            with self.subTest(url=url), self.assertRaises(ValueError):
                checked_url(url, ['example.com'])

    def test_private_dns_rejected(self):
        from urllib.error import URLError
        with self.assertRaises(URLError):
            checked_url('https://127.0.0.1/', ['127.0.0.1'])

    def test_hash_stable_across_nights_but_changes_with_evidence(self):
        a = candidate(SOURCE, 'Try a free trial for 30 days.', SOURCE['url'], NOW)
        b = candidate(SOURCE, 'Try a free trial for 30 days.', SOURCE['url'], '2026-09-09T12:00:00+00:00')
        c = candidate(SOURCE, 'Try a free trial for 14 days.', SOURCE['url'], NOW)
        self.assertEqual(a['id'], b['id'])
        self.assertNotEqual(a['id'], c['id'])
        self.assertEqual(a['verificationStatus'], 'unverified')
        self.assertNotIn('trialDays', a)

    def test_no_signal_is_not_a_candidate(self):
        self.assertIsNone(candidate(SOURCE, 'Welcome to our website.', SOURCE['url'], NOW))

    def test_policy_expiry_prevents_fetch(self):
        fetcher = Fetcher()
        with patch.object(fetcher, 'fetch') as fetch:
            items, results = collect([{**SOURCE, 'policy_reviewed': '2025-01-01'}], fetcher, NOW)
            self.assertEqual(items, [])
            self.assertEqual(results[0]['status'], 'needs_review')
            fetch.assert_not_called()

    def test_failed_fetch_is_not_expired_offer(self):
        fetcher = Fetcher()
        with patch.object(fetcher, 'fetch', side_effect=ValueError('HTTP 403')):
            items, results = collect([SOURCE], fetcher, NOW)
            self.assertEqual(items, [])
            self.assertEqual(results[0]['status'], 'needs_review')

    @patch('nightly.checked_url')
    def test_robots_failure_closed(self, checked):
        from urllib.parse import urlsplit
        checked.side_effect = lambda url, hosts: urlsplit(url)
        fetcher = Fetcher()
        with patch.object(fetcher, 'request', return_value=(503, {}, 'down')):
            with self.assertRaises(ValueError):
                fetcher.policy(SOURCE['url'], ['example.com'])

    @patch('nightly.checked_url')
    def test_robots_denied_and_wildcard(self, checked):
        from urllib.parse import urlsplit
        checked.side_effect = lambda url, hosts: urlsplit(url)
        for rule in ['/pricing', '/*cing$']:
            fetcher = Fetcher()
            with patch.object(fetcher, 'request', return_value=(200, {}, 'User-agent: *\nDisallow: ' + rule)):
                with self.assertRaises(ValueError):
                    fetcher.policy(SOURCE['url'], ['example.com'])

    @patch('nightly.checked_url')
    def test_missing_robots_allowed(self, checked):
        from urllib.parse import urlsplit
        checked.side_effect = lambda url, hosts: urlsplit(url)
        fetcher = Fetcher()
        with patch.object(fetcher, 'request', return_value=(404, {}, 'missing')):
            self.assertEqual(fetcher.policy(SOURCE['url'], ['example.com']), 2)

    def test_chicago_schedule_and_catchup(self):
        self.assertFalse(is_due({}, datetime.fromisoformat('2026-09-08T07:59:00+00:00')))
        self.assertTrue(is_due({}, datetime.fromisoformat('2026-09-08T08:00:00+00:00')))
        self.assertTrue(is_due({}, datetime.fromisoformat('2026-09-08T17:00:00+00:00')))
        self.assertFalse(is_due({'scheduledCollectionDate': '2026-09-08'}, datetime.fromisoformat(NOW)))
        self.assertFalse(is_due({}, datetime.fromisoformat('2026-12-08T08:59:00+00:00')))
        self.assertTrue(is_due({}, datetime.fromisoformat('2026-12-08T09:00:00+00:00')))

    def test_report_escapes_untrusted_text(self):
        item = candidate({**SOURCE, 'label': '<script>bad()</script>'}, 'free trial <img onerror=bad()>', SOURCE['url'], NOW)
        html = review_report([item], {'id': 'run', 'status': 'collected', 'sourceResults': []})
        self.assertNotIn('<script>', html)
        self.assertIn('&lt;script&gt;', html)


if __name__ == '__main__':
    unittest.main()
