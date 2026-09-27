"""Access rules are pure fixture tests: no network requests or robots bypass."""
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit

from collector import RobotsChecker, parse_robots, robots_allowed
from nightly import Fetcher


class RobotsPrecedenceTest(unittest.TestCase):
    def allowed(self, policy, path):
        return robots_allowed('https://example.com' + path, parse_robots(policy)[0])[0]

    def test_more_specific_allow_and_more_specific_disallow(self):
        rules = ['Disallow: /', 'Allow: /public/', 'Disallow: /public/private/']
        for ordered in [rules, list(reversed(rules))]:
            policy = 'User-agent: *\n' + '\n'.join(ordered)
            for path, expected in [('/public/page', True), ('/public/private/page', False), ('/elsewhere', False)]:
                with self.subTest(path=path, order=ordered):
                    self.assertEqual(self.allowed(policy, path), expected)

    def test_equal_length_allow_wins_independent_of_order(self):
        for rules in ['Allow: /same\nDisallow: /same', 'Disallow: /same\nAllow: /same']:
            self.assertTrue(self.allowed('User-agent: *\n' + rules, '/same/page'))

    def test_wildcards_terminal_anchor_query_and_case(self):
        policy = 'User-agent: *\nDisallow: /*.pdf$\nAllow: /public/*.pdf$\nDisallow: /*?private=*'
        for path, expected in [('/a.pdf', False), ('/public/a.pdf', True), ('/a.pdf?download=1', True), ('/a?private=yes', False), ('/a.PDF', True)]:
            with self.subTest(path=path):
                self.assertEqual(self.allowed(policy, path), expected)

    def test_explicit_agent_groups_merge_without_wildcard_or_other_agent_leak(self):
        policy = ('User-agent: *\nDisallow: /\nCrawl-delay: 50\n'
                  'User-agent: TryWiseBot\nDisallow: /one\nCrawl-delay: 4\n'
                  'User-agent: OtherBot\nDisallow: /public\n'
                  'User-agent: TRYWISEBOT\nDisallow: /two\nAllow: /one/public\nCrawl-delay: 8\n')
        rules, delay = parse_robots(policy)
        self.assertEqual(delay, 8)
        for path, expected in [('/one', False), ('/two', False), ('/one/public', True), ('/public', True)]:
            self.assertEqual(robots_allowed('https://example.com' + path, rules)[0], expected)

    def test_empty_or_missing_rules_allow_and_unknown_extensions_do_not_split_groups(self):
        self.assertTrue(self.allowed('User-agent: *\nDisallow: /\nUser-agent: TryWiseBot\nDisallow:', '/anything'))
        self.assertTrue(self.allowed('Disallow: /\nUser-agent: OtherBot\nDisallow: /', '/anything'))
        self.assertFalse(self.allowed('User-agent: TryWiseBot\nSitemap: https://example.com/map\nUser-agent: OtherBot\nDisallow: /', '/anything'))
        self.assertEqual(parse_robots('User-agent: *\nCrawl-delay: NaN\nCrawl-delay: -1\nCrawl-delay: inf')[1], None)

    def test_equivalent_encoding_and_reserved_separator_distinction(self):
        policy = 'User-agent: *\nDisallow: /café\nDisallow: /private\nDisallow: /a%2Fb\nDisallow: /literal%2A'
        for path, expected in [('/caf%C3%A9', False), ('/café', False), ('/%70rivate', False), ('/a%2fb', False), ('/a/b', True), ('/literal*', False), ('/literal-other', True)]:
            with self.subTest(path=path):
                self.assertEqual(self.allowed(policy, path), expected)

    @patch('collector.http_get')
    def test_collector_checker_uses_same_precedence(self, request):
        request.return_value = (200, {}, b'User-agent: *\nDisallow: /\nAllow: /pricing\nCrawl-delay: 3')
        checker = RobotsChecker()
        self.assertEqual(checker.check('https://example.com/pricing')[:2], (True, 3))
        self.assertFalse(checker.check('https://example.com/private')[0])
        self.assertEqual(request.call_count, 1)

    @patch('nightly.checked_url')
    def test_nightly_collector_uses_same_precedence_and_agent_scope(self, checked):
        checked.side_effect = lambda url, hosts: urlsplit(url)
        policy = 'User-agent: *\nDisallow: /\nUser-agent: TryWiseBot\nDisallow: /\nAllow: /pricing\nCrawl-delay: 4\nUser-agent: OtherBot\nDisallow: /*'
        fetcher = Fetcher()
        with patch.object(fetcher, 'request', return_value=(200, {}, policy)):
            self.assertEqual(fetcher.policy('https://example.com/pricing', ['example.com']), 4)
            with self.assertRaisesRegex(ValueError, 'Disallowed'):
                fetcher.policy('https://example.com/private', ['example.com'])


if __name__ == '__main__':
    unittest.main()
