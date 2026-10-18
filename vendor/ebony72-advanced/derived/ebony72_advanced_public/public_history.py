"""Methods extracted unchanged from upstream xzdealer.py:50-174."""

class PublicHistoryModel:
    __slots__ = ("act_history", "dqc")

    def __init__(self, history, missing_suits):
        self.act_history = history
        self.dqc = missing_suits

    def extract_player_history(self, i):
        ''' Extract the action history of Player i '''
        i_act_history = list(x for x in self.act_history if x[0] == i)
        return i_act_history

    def proceed_color_distribution(self, phi, dc, action, last_card):
        ''' Proceed the color distribution based on current distribution and the player's last action
            Args:
                phi (list): the current distribution
                dc (int): daque color
                last_card (mahjong tile): either the last discarded tile or the pong/kong tile
                action (str): 'discard', 'pong', 'kong', etc


        '''
        if action == 'draw': #what is last_card here? set as None
            for i in range(0,3):
                phi[i] += 1/3
            return phi
        

        c = last_card[0] #last_card could be the discarded tile or pong/kong-tile
        if action == 'discard':
            if c == dc:
                if phi[c] >= 1: # we still have daque color
                    phi[c] += -1
                else: # for example, if we have discarded the daque color 3 times, phi[c] is at most 1 here if no pong/kong happend before 
                    theta = (phi[c]-1)/2
                    phi[(c+1)%3] += theta
                    phi[(c+2)%3] += theta
                    phi[c] = 0
                return phi
            ''' If c != dc, we retract as the player has no daque color in his hand'''
            
            theta = (phi[dc]-1)/2
            phi[(dc+1)%3] += theta
            phi[(dc+2)%3] += theta
            phi[dc] = 0
            return phi

        if c == dc:
            print('The color of last_card should not be the daque color here.')
            return phi

        ''' When last_action is pong/kong/hu/zimo/ankong/jiakong '''
        
        if dc == (c+1)%3:
            cx = (c+2)%3
        else:
            cx = (c+1)%3
        h = phi[c] + phi[cx] + phi[dc] #number of tiles in the hand

        if action == 'pong':                            
            if phi[c] >= 2.5:
                phi[c] += -2
            else: #adjust phi
                phi[cx] += phi[c]-2.5
                phi[c] = 0.5 # very unlikely we don't have color c in hand?
            return phi
        if action == 'kong': # revealed kong
            if phi[c] >= 3.5:
                phi[c] += -3
            else: #adjust phi
                phi[cx] += phi[c]-3.5
                phi[c] = 0.5
            return phi
        if action == 'ankong': # ankong (the player just drew a tile)
            if phi[c] >= 4.5:
                phi[c] += -4
            else: #adjust phi
                phi[cx] += phi[c]-4.5
                phi[c] = 0.5
            return phi
        if action == 'jiakong': # jiakong (the player just drew a tile)
            if phi[c] >= 1.5:
                phi[c] += -1
            else: #adjust phi
                phi[cx] += phi[c]-1.5
                phi[c] = 0.5
            return phi
        if action in {'hu', 'zimo', 'robkong'}:
            theta = phi[dc]
            phi[(dc+1)%3] += theta/2
            phi[(dc+2)%3] += theta/2
            phi[dc] = 0
            return phi

    def guess_color_distribution(self, j):
        ''' Compute the color distribution of the hand of player j from the viewpoint of player i
        Args:
            players (objects):
            j (int): The id of a player
        Return: 
            pi (list): A distribution of three colors such that pi[0] + pi[1] + pi[2] is the
                        length of the hand of player j and pi[0] is the estimated number of Bamboo tiles 
        '''
        j_act_history = self.extract_player_history(j)
        #discard_list = deepcopy(self.discard_lists[j])
        dc = self.dqc[j]
        #win_info = self.win_info[j]
        #draw_time = self.draw_times[j]

        '''Set the initial distribution '''
        phi = [0, 0, 0]
        if j == 0:
            phi[dc] = 4
        else:
            phi[dc] = 3
        phi[(dc+1)%3] = 5
        phi[(dc+2)%3] = 5

        l = len(j_act_history)
        for act in j_act_history:
            if act[0] != j:
                print('Something wrong! The actor is not %s' %j)
                return phi
            action = act[1]
            if action == 'draw':
                last_card = None
            else:
                last_card = act[2]
            phi = self.proceed_color_distribution(phi, dc, action, last_card)

        return [round(phi[0], 1), round(phi[1], 1), round(phi[2], 1)]

