"""Read-only own-hand methods extracted from upstream xzplayer.py:64-98."""

class OwnHandHelpers:
    __slots__ = ()

    def get_dominant_color(self):
        ''' Return the dominant color 0, 1, 2, or None'''
        dc = self.daque_color
        hand = self.hand
        pile = self.pile
        pile_color = set()
        #2020021521-sl
        if pile:
            for p in pile:
                pile_color.add(p[0][0])
        if len(pile_color) > 1:
            return None
        for c in {0, 1, 2}:
            if c == dc:
                continue
            #2020031017-sl: revised
            hand_c = list(t for t in hand if t[0] == c)
            if len(hand_c) + 3*len(pile) > 8 and \
               (not pile or (pile and c in pile_color)): #2020031210-sl
                #q is 8 a good estimation?
                return c
        return None

    def get_pure_color_index(self):
        ''' Return the dominant color '''
        dc = self.daque_color
        hand = self.hand
        pile = self.pile
        c = self.get_dominant_color()
        if c == None:
            return 0
        hand_c = list(t for t in hand if t[0] == c)
        index = len(hand_c) + 3*len(pile)
        return index

