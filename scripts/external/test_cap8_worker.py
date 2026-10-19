"""Real public JSONL requests for the separately identified cap8 candidate."""
import copy
import json
from pathlib import Path
import unittest

import worker

WIRE = 'ebony72-advanced-cap8-discard-v1'


def request():
    value = json.loads((Path(__file__).parent / 'fixtures/advanced-dev-80007-wall-empty.request.json').read_text(encoding='utf-8'))
    value['policy'] = WIRE
    return value


class Cap8WorkerTests(unittest.TestCase):
    def test_real_wall_empty_request_is_legal_and_does_not_change_original(self):
        cap = request()
        original = copy.deepcopy(cap)
        original['policy'] = 'ebony72-advanced-public-v1'
        before = worker.handle_request(original)
        self.assertIn('action', before)
        actual = worker.handle_request(cap)
        self.assertIn('action', actual)
        self.assertEqual(actual['action']['type'], 'discard')
        self.assertIn(actual['action']['tile'], cap['view']['legalDiscards'])
        self.assertEqual(worker.handle_request(original), before)

    def test_cap8_still_requires_complete_public_history(self):
        value = request()
        del value['view']['publicActions']
        error = worker.handle_request(value)['error']
        self.assertEqual(error['code'], 'invalid-view')
        self.assertIn('publicActions', error['message'])

    def test_cap8_rejects_opponent_private_hand_before_dispatch(self):
        value = request()
        value['view']['opponents'][0]['hand'] = [1, 2, 3]
        error = worker.handle_request(value)['error']
        self.assertEqual(error['code'], 'hidden-field')
        self.assertIn('hand', error['message'])


if __name__ == '__main__':
    unittest.main()
