import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock

from draft_fields import Drafter, MODEL, attach_quotes, excerpts, context_text, validate_fields
from nightly import atomic_json, candidate, collect
from test_nightly import SOURCE, NOW

TEXT = 'Demo Free plan has no monthly charge. New individual accounts only.'


def response():
    return {'name': {'value': 'Demo Free', 'quote': 'Demo Free plan has no monthly charge.'},
            'offerType': {'value': 'free_tier', 'quote': 'Demo Free plan has no monthly charge.'},
            'monthlyValue': {'value': 0, 'quote': 'Demo Free plan has no monthly charge.'}}


class DraftTest(unittest.TestCase):
    def test_unmatched_quote_and_extra_privileged_fields(self):
        clean, warnings = validate_fields({'region': {'value': 'Worldwide', 'quote': 'Available everywhere'}}, TEXT)
        self.assertEqual(clean, {})
        self.assertTrue(warnings)
        for key in ['status', 'id', 'url', '__proto__', 'reviewedBy', 'confirmed']:
            with self.assertRaises(ValueError):
                validate_fields({key: 'approved'}, TEXT)

    def test_conflicting_free_paid_terms_and_bad_numbers(self):
        raw = response()
        raw['monthlyValue']['value'] = 10
        raw['trialDays'] = {'value': 30, 'quote': raw['offerType']['quote']}
        clean, _ = validate_fields(raw, TEXT)
        self.assertNotIn('monthlyValue', clean)
        self.assertNotIn('trialDays', clean)
        for value in [True, -1, 100001, float('nan'), float('inf'), '12']:
            raw = {'monthlyValue': {'value': value, 'quote': TEXT}}
            self.assertNotIn('monthlyValue', validate_fields(raw, TEXT)[0])

    def test_non_usd_price_not_prefilled(self):
        raw = {'monthlyValue': {'value': 10, 'quote': TEXT}, 'currency': {'value': 'EUR', 'quote': TEXT}}
        self.assertNotIn('monthlyValue', validate_fields(raw, TEXT)[0])

    def test_invented_numeric_prices_and_mixed_plan_terms(self):
        raw = response()
        raw['priceDetails'] = {'value': '$0.30 per million', 'quote': TEXT}
        raw['eligibility'] = {'value': 'Teachers may get Copilot Pro', 'quote': TEXT}
        clean, warnings = validate_fields(raw, TEXT)
        self.assertNotIn('priceDetails', clean)
        self.assertNotIn('eligibility', clean)
        self.assertGreaterEqual(len(warnings), 2)
        self.assertEqual(validate_fields({'priceDetails': {'value': 'Free', 'quote': '-'*80}}, '-'*80)[0], {})

    def test_bounded_context(self):
        self.assertLessEqual(len(context_text('free plan ' * 10000)), 16000)
        self.assertTrue(all(len(v)<=280 for v in excerpts('free plan ' * 1000)))
        self.assertEqual(attach_quotes({'name': {'value':'Demo','evidenceIndex':999}},[TEXT]),{})
        self.assertEqual(attach_quotes({'name': {'value':'Demo','evidenceIndex':True}},[TEXT]),{})

    def test_cache_dedup_and_no_approval(self):
        with tempfile.TemporaryDirectory() as directory:
            api = Mock(side_effect=[{'models': [{'name': MODEL, 'details': {'format': 'gguf'}}]},
                {'done': True, 'message': {'content': json.dumps({key:{'value':field['value'],'evidenceIndex':0} for key,field in response().items()})}}])
            drafter = Drafter(directory, atomic_json, api)
            item = candidate(SOURCE, TEXT, SOURCE['url'], NOW)
            result = drafter.enrich(item, TEXT)
            self.assertEqual(result['draftStatus'], 'ready')
            self.assertEqual(result['status'], 'pending_review')
            self.assertEqual(result['verificationStatus'], 'unverified')
            self.assertNotEqual(result['id'], item['id'])
            self.assertEqual(result['draftParentId'], item['id'])
            second = drafter.enrich({**item, 'observedAt': '2026-09-09T12:00:00Z'}, TEXT)
            self.assertEqual(result['id'], second['id'])
            self.assertEqual(api.call_count, 2)
            request = api.call_args_list[1].args[1]
            self.assertEqual(request['model'], MODEL)
            self.assertNotIn('tools', request)

    def test_timeout_and_run_budget_keep_raw_candidates(self):
        with tempfile.TemporaryDirectory() as directory:
            api = Mock(side_effect=TimeoutError())
            drafter = Drafter(directory, atomic_json, api)
            item = candidate(SOURCE, TEXT, SOURCE['url'], NOW)
            for _ in range(2):
                result = drafter.enrich(item, TEXT)
                self.assertEqual(result['id'], item['id'])
                self.assertEqual(result['draftStatus'], 'unavailable_or_invalid')
            self.assertEqual(drafter.enrich(item, TEXT)['draftStatus'], 'deferred_run_limit')
            self.assertEqual(api.call_count, 2)

    def test_remote_model_and_tool_calls_denied(self):
        for responses in [
            [{'models': [{'name': MODEL, 'remote_host': 'cloud.example', 'details': {'format': 'gguf'}}]}],
            [{'models': [{'name': MODEL, 'details': {'format': 'gguf'}}]}, {'done': True, 'message': {'tool_calls': ['publish']}}],
            [{'models': [{'name': MODEL, 'details': {'format': 'gguf'}}]}, {'done': True, 'done_reason': 'length', 'message': {'content': '{}'}}],
        ]:
            with tempfile.TemporaryDirectory() as directory:
                drafter = Drafter(directory, atomic_json, Mock(side_effect=responses))
                self.assertEqual(drafter.enrich(candidate(SOURCE,TEXT,SOURCE['url'],NOW),TEXT)['draftStatus'], 'unavailable_or_invalid')

    def test_collection_survives_model_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            drafter = Drafter(directory, atomic_json, Mock(side_effect=TimeoutError()))
            fetcher = Mock()
            fetcher.fetch.return_value = (TEXT, SOURCE['url'])
            items, results = collect([SOURCE], fetcher, NOW, drafter)
            self.assertEqual(len(items), 1)
            self.assertEqual(results[0]['status'], 'fetched')
            self.assertEqual(results[0]['draftStatus'], 'unavailable_or_invalid')


if __name__ == '__main__':
    unittest.main()
