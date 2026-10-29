import copy
import json
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
import advanced_policy
import worker
import public_discard_diagnostics as observer

CASES=json.loads(Path(__file__).with_name('fixtures').joinpath('observed-discard-v1.json').read_text(encoding='utf-8'))['cases']
A='ebony72-advanced-public-v1'
def context(view):return advanced_policy.build_context(view,worker.build_context(view),worker)
class ActualDiscardObservation(unittest.TestCase):
    def test_one_real_call_returns_same_action_and_actual_branch_on_two_known_public_frames(self):
        policy=advanced_policy.load_policy()
        before=dict(vars(policy))
        for case in CASES:
            with self.subTest(case=case['name']):
                view=copy.deepcopy(case['view']);snapshot=copy.deepcopy(view);calls=[]
                def choose(*args,**kwargs):calls.append(1);return worker.choose_action(*args,**kwargs)
                result=observer.observe_discard_decision(SimpleNamespace(choose_action=choose),'discard',view,context(view),policy,A)
                self.assertEqual(result['action'],case['expectedAction']);self.assertEqual(calls,[1]);self.assertEqual(view,snapshot)
                d=result['diagnostics'];self.assertEqual(d['version'],2);self.assertEqual(d['coverage'],'observed-discard-branch')
                self.assertEqual(d['discard']['root']['function'],'select_a_card_to_discard')
                self.assertEqual(d['discard']['root']['tile'],result['action']['tile'])
                self.assertEqual(d['discard']['path'],case['name'])
                self.assertTrue(d['discard']['frames'])
        self.assertEqual(before,vars(policy));self.assertIsNone(sys.gettrace())
    def test_existing_trace_is_not_overwritten_and_no_policy_is_called(self):
        view=copy.deepcopy(CASES[0]['view']);ctx=context(view);calls=[]
        def sentinel(*args):return None
        original=sys.gettrace();sys.settrace(sentinel)
        try:
            with self.assertRaisesRegex(ValueError,'existing trace'):
                observer.observe_discard_decision(SimpleNamespace(choose_action=lambda *a,**k:calls.append(1)),'discard',view,ctx,advanced_policy.load_policy(),A)
            self.assertIs(sys.gettrace(),sentinel);self.assertEqual(calls,[])
        finally:sys.settrace(original)
    def test_unknown_policy_object_rejected_before_call(self):
        view=copy.deepcopy(CASES[0]['view']);calls=[]
        with self.assertRaises(ValueError):
            observer.observe_discard_decision(SimpleNamespace(choose_action=lambda *a,**k:calls.append(1)),'discard',view,context(view),SimpleNamespace(),A)
        self.assertEqual(calls,[])
    def test_actual_policy_exception_propagates_and_trace_is_restored(self):
        view=copy.deepcopy(CASES[0]['view'])
        def fail(*args,**kwargs):raise RuntimeError('actual choice failed')
        with self.assertRaisesRegex(RuntimeError,'actual choice failed'):
            observer.observe_discard_decision(SimpleNamespace(choose_action=fail),'discard',view,context(view),advanced_policy.load_policy(),A)
        self.assertIsNone(sys.gettrace())
if __name__=='__main__':unittest.main()
