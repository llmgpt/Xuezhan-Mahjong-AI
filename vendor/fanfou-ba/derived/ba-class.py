class Fan_Fou_basic(MahJong_NO_State_Base):
    def __init__(self, seat, majiang):
        """每个玩家获取手牌"""
        # 存储游戏玩家所有的状态数据
        self.StateData = np.zeros(shape=(4, 7, 4, 9), dtype=np.int8)
        # 所有已知牌的统计
        # self.ShowCount = np.zeros(shape=(4, 9), dtype=np.int8)
        # 当前决策者的座位号
        self.player_seat = seat
        self.majiang = majiang
        self.gang = []
        self.peng = []
        self.chi = []
        # MahJong_NO_State_Base.ShowCount = np.zeros(shape=(4, 9), dtype=np.int8)
        # self.showcount = np.zeros(shape=(4, 9), dtype=np.int8)
        for i in range(13):
            line, row = self._get_array_index(majiang[i])
            self.StateData[seat, 0, line, row] += 1
            # self.ShowCount[line, row] += 1
            # MahJong_NO_State_Base.ShowCount[line, row] += 1
            # self.showcount[line, row] += 1
        print('Fan_fou_basic玩家{}的起手牌是{}'.format(self.player_seat, self.majiang))
        print('Fan_fou_basic玩家{}的起手牌矩阵是{}\n'.format(self.player_seat, self.StateData[self.player_seat, 0]))
        print('MahJong_NO_State_Base.ShowCount',MahJong_NO_State_Base.ShowCount)
        # print('self.showcount', self.showcount)

    def get_new_majiang(self, seat, majiang):
        """确定庄家，获得一张牌，开始游戏"""
        # print('玩家{}获得一张牌前的手牌{}以及手牌矩阵是'.format(seat, self.majiang))
        # print(self.StateData[seat, 0])
        self.majiang.append(majiang)
        line, row = self._get_array_index(majiang)
        self.StateData[seat, 0, line, row] += 1
        # if self.player_seat == 0:
        # self.showcount[line, row] += 1

    def del_ourself_drw(self):
        '''
        处理自己的摸牌动作
        :return:
        '''
        # print('MahJong_NO_State_Base.ShowCount',MahJong_NO_State_Base.ShowCount)
        # print('self.showcount', self.showcount)
        # self.showcount += MahJong_NO_State_Base.ShowCount
        # print('self.showcount+', self.showcount)
        hand_array = copy.deepcopy(self.StateData[self.player_seat, 0])
        # discard_history = self.showcount + MahJong_NO_State_Base.ShowCount - hand_array
        discard_history = MahJong_NO_State_Base.ShowCount

        # if self.Now_Deal != {}:
        #     line, row = self._get_card_index(self.Now_Deal)
        #     print(line, row)
        hand_array_cupple = []
        hand_array_triplet = []
        for i in range(3):
            for j in range(9):
                if hand_array[i, j] == 2:
                    hand_array_cupple.append([i, j])
                if hand_array[i, j] == 3:
                    hand_array_triplet.append([i, j])

        try:
            # 然后整理牌面 做出弃牌选择后再判断是否可以听
            hand_array_else_first = []
            hand_array_else_second = []
            hand_array_else_third = []
            hand_array_else_last = []

            # discard_history = self.ShowCount - hand_array
            print('MahJong_NO_State_Base.ShowCount', MahJong_NO_State_Base.ShowCount)
            # print('self.showcount', self.showcount)
            # print('Fan_fou所有已知牌包括自己手牌\n', self.showcount)
            print('Fan_fou_basic自己手牌\n', hand_array)
            print('Fan_fou_basic已经打出去的牌是\n', discard_history)
            # chow_hand_card = self.MessData['chow_hand']
            # print('输出当前的已经吃的牌是啥：', chow_hand_card)
            chow_hand_card = self.chi
            print('Fan_fou_basic当前已经吃的牌是啥：', chow_hand_card)

            # 杂牌第一优先级 单张左右两位置都为0
            for i in range(3):
                if hand_array[i,0]==1 and hand_array[i,1]==0 and hand_array[i,2]==0:
                    hand_array_else_first.append([i, 0])
                if hand_array[i,8]==1 and hand_array[i,7]==0 and hand_array[i,6]==0:
                    hand_array_else_first.append([i, 8])
                if hand_array[i,1]==1 and hand_array[i,0]==0 and hand_array[i,2]==0 and hand_array[i,3]==0:
                    hand_array_else_first.append([i, 1])
                if hand_array[i,7]==1 and hand_array[i,8]==0 and hand_array[i,6]==0 and hand_array[i,5]==0:
                    hand_array_else_first.append([i, 7])
            for x in range(3):
                for j in range(2,7):
                    if hand_array[x,j]==1 and hand_array[x,j-2]==0 and hand_array[x,j-1]==0 and hand_array[x,j+1]==0 and hand_array[x,j+2]==0:
                        hand_array_else_first.append([x,j])

            # 第二优先级 单张间距1位置0 间距2位置1
            for j in range(3):
                # 679 6779
                if hand_array[j,8]==1 and hand_array[j,7]==0 and hand_array[j,6]!=0 and hand_array[j,5]==1:
                    hand_array_else_second.append([j, 8])
                # 689 6889
                if hand_array[j,8]==1 and hand_array[j,7]!=0 and hand_array[j,6]==0 and hand_array[j,5]==1:
                    hand_array_else_second.append([j, 8])
                # 134 1334
                if hand_array[j,0]==1 and hand_array[j,1]==0 and hand_array[j,2]!=0 and hand_array[j,3]==1:
                    hand_array_else_second.append([j, 0])
                # 124 1224
                if hand_array[j,0]==1 and hand_array[j,1]!=0 and hand_array[j,2]==0 and hand_array[j,3]==1:
                    hand_array_else_second.append([j, 0])
                # 123400
                if hand_array[j,0]==1 and hand_array[j,1]==1 and hand_array[j,2]==1 and hand_array[j,3]==1 and hand_array[j,4]==0 and hand_array[j,5]==0:
                    hand_array_else_second.append([j, 0])
                # 987600
                if hand_array[j,8]==1 and hand_array[j,7]==1 and hand_array[j,6]==1 and hand_array[j,5]==1 and hand_array[j,4]==0 and hand_array[j,3]==0:
                    hand_array_else_second.append([j, 8])

                # 103,120
                if (hand_array[j,0]==1 and hand_array[j,1]==0 and hand_array[j,2]==1) or (hand_array[j,0]==1 and hand_array[j,1]==1 and hand_array[j,2]==0):
                    hand_array_else_second.append([j, 0])
                # 907,980
                if (hand_array[j,8]==1 and hand_array[j,7]==0 and hand_array[j,6]==1) or (hand_array[j,8]==1 and hand_array[j,7]==1 and hand_array[j,6]==0):
                    hand_array_else_second.append([j, 8])

            for i in range(3):
                if len(hand_array_cupple) > 1:
                    #  1223和7889打2和8
                    if hand_array[i,0]==1 and hand_array[i,1]==2 and hand_array[i,2]==1 and hand_array[i,3]==0:
                        hand_array_else_second.append([i,1])
                    if hand_array[i,8]==1 and hand_array[i,7]==2 and hand_array[i,6]==1 and hand_array[i,5]==0:
                        hand_array_else_second.append([i,7])

            for i in range(3):
                # (1) 2450,24450or2455
                if (hand_array[i, 1]==1 and hand_array[i, 2]==0 and hand_array[i, 3]!=0 and hand_array[i, 4]==1 and hand_array[i, 0]!=1) or (hand_array[i, 1]==1 and hand_array[i, 2]==0 and hand_array[i, 3]==1 and hand_array[i, 4]!=0 and hand_array[i, 0]!=1):
                    hand_array_else_second.append([i, 1])
                # 5680,56680,55680 (1)
                if (hand_array[i, 7]==1 and hand_array[i, 6]==0 and hand_array[i, 5]!=0 and hand_array[i, 4]==1 and hand_array[i, 8]!=1) or (hand_array[i, 7]==1 and hand_array[i, 6]==0 and hand_array[i, 5]==1 and hand_array[i, 4]!=0 and hand_array[i, 8]!=1):
                    hand_array_else_second.append([i, 7])
            for i in range(3):
                # 00356,3556,3566(1)-00578,5778,5788(1)
                for j in range(2,5):
                    if (hand_array[i, j]==1 and hand_array[i, j+1]==0 and hand_array[i, j+2]!=0 and hand_array[i, j+3]==1 and hand_array[i, j+4]!=1 and hand_array[i, j-1]==0 and hand_array[i, j-2]==0) or (hand_array[i, j]==1 and hand_array[i, j+1]==0 and hand_array[i, j+2]==1 and hand_array[i, j+3]!=0 and hand_array[i, j+4]!=1 and hand_array[i, j-1]==0 and hand_array[i, j-2]==0):
                        hand_array_else_second.append([i, j])
                # (1)235,2335,223500-(1)457,4557,445700
                for j in range(4,7):
                    if (hand_array[i, j]==1 and hand_array[i, j+1]==0 and hand_array[i, j+2]==0 and hand_array[i, j-1]==0 and hand_array[i, j-2]!=0 and hand_array[i, j-3]==1 and hand_array[i, j-4]!=1) or (hand_array[i, j]==1 and hand_array[i, j+1]==0 and hand_array[i, j+2]==0 and hand_array[i, j-1]==0 and hand_array[i, j-2]==1 and hand_array[i, j-3]!=0 and hand_array[i, j-4]!=1):
                        hand_array_else_second.append([i, j])

            # 从第三级最开始提上来 加的最后优先级对子间距1位置1 只能吃1个位置 1220,122345,133,1244,9880,988765,977,9866
            for j in range(3):
                if hand_array[j, 1] == 2 and hand_array[j, 0] == 1 and hand_array[j, 2] == 0:
                    hand_array_else_second.append([j, 0])
                if hand_array[j,0]==1 and hand_array[j,1]==2 and hand_array[j,2]==1 and hand_array[j,3]==1 and hand_array[j,4]==1:
                    hand_array_else_second.append([j, 0])
                if hand_array[j,0]==1 and hand_array[j,1]==0 and hand_array[j,2]==2:
                    hand_array_else_second.append([j, 0])
                if hand_array[j,1]==1 and hand_array[j,2]==0 and hand_array[j,3]==2 and hand_array[j,0]==1:
                    hand_array_else_second.append([j, 0])
                if hand_array[j, 7] == 2 and hand_array[j, 8] == 1 and hand_array[j, 6] == 0:
                    hand_array_else_second.append([j, 8])
                if hand_array[j,8]==1 and hand_array[j,7]==2 and hand_array[j,6]==1 and hand_array[j,5]==1 and hand_array[j,4]==1:
                    hand_array_else_second.append([j, 8])
                # 779,6689
                if hand_array[j, 8] == 1 and hand_array[j, 7] == 0 and hand_array[j, 6] == 2:
                    hand_array_else_second.append([j, 8])
                if hand_array[j, 8] == 1 and hand_array[j, 7] == 1 and hand_array[j, 6] == 0 and hand_array[j, 5] == 2:
                    hand_array_else_second.append([j, 8])

            for i in range(3):
                # 第三优先级提上来的  12230和07889打2和8
                if hand_array[i,0]==1 and hand_array[i,1]==2 and hand_array[i,2]==1 and hand_array[i,3]==0:
                    hand_array_else_second.append([i,1])
                if hand_array[i,8]==1 and hand_array[i,7]==2 and hand_array[i,6]==1 and hand_array[i,5]==0:
                    hand_array_else_second.append([i,7])

            for i in range(3):
                # 刻子旁边的单牌
                # 1222和8889单列
                if hand_array[i,0]==1 and hand_array[i,1]==3 and hand_array[i,2]!=1:
                    hand_array_else_second.append([i,0])
                if hand_array[i,8]==1 and hand_array[i,7]==3 and hand_array[i,6]!=1:
                    hand_array_else_second.append([i,8])
                # 1333和7779单列
                if hand_array[i,0]==1 and hand_array[i,1]!=1 and hand_array[i,2]==3:
                    hand_array_else_second.append([i,0])
                if hand_array[i,8]==1 and hand_array[i,7]!=1 and hand_array[i,6]==3:
                    hand_array_else_second.append([i,8])
                # 02333
                if hand_array[i,0]==0 and hand_array[i,1]==1 and hand_array[i,2]==3:
                    hand_array_else_second.append([i,1])
                # 77780
                if hand_array[i,8]==0 and hand_array[i,7]==1 and hand_array[i,6]==3:
                    hand_array_else_second.append([i,7])
            for i in range(3):
                # 003444-008999
                for j in range(2, 8):
                    if hand_array[i,j]==1 and hand_array[i,j+1]==3 and hand_array[i,j-1]==0 and hand_array[i,j-2]==0:
                            hand_array_else_second.append([i,j])
                # 111200-666700
                for j in range(1, 7):
                    if hand_array[i,j]==1 and hand_array[i,j-1]==3 and hand_array[i,j+1]==0 and hand_array[i,j+2]==0:
                            hand_array_else_second.append([i,j])
                # 020444-070999
                for j in range(1, 7):
                    if hand_array[i,j]==1 and hand_array[i,j+1]==0 and hand_array[i,j+2]==3 and hand_array[i,j-1]==0:
                            hand_array_else_second.append([i,j])
                # 111030-666080
                for j in range(2, 8):
                    if hand_array[i,j]==1 and hand_array[i,j-1]==0 and hand_array[i,j-2]==3 and hand_array[i,j+1]==0:
                        hand_array_else_second.append([i, j])

            for i in range(3):
                # 2456(0/2)-4678(0/2)
                for j in range(1,4):
                    if hand_array[i, j]==1 and hand_array[i, j+1]==0 and hand_array[i, j+2]==1 and hand_array[i, j+3]==1 and hand_array[i, j+4]==1 and hand_array[i, j+5]!=1:
                        hand_array_else_second.append([i, j])
                # 8654(0/2)-6432(0/2)
                for j in range(7,4,-1):
                    if hand_array[i, j]==1 and hand_array[i, j-1]==0 and hand_array[i, j-2]==1 and hand_array[i, j-3]==1 and hand_array[i, j-4]==1 and hand_array[i, j-5]!=1:
                        hand_array_else_second.append([i, j])

            for i in range(3):
                # 005789or123500
                if (hand_array[i,4]==1 and hand_array[i,5]==0 and hand_array[i,6]==1 and hand_array[i,7]==1 and hand_array[i,8]==1 and hand_array[i,3]==0 and hand_array[i,2]==0) or (hand_array[i,4]==1 and hand_array[i,3]==0 and hand_array[i,2]==1 and hand_array[i,1]==1 and hand_array[i,0]==1 and hand_array[i,5]==0 and hand_array[i,6]==0):
                    hand_array_else_second.append([i,4])

            for i in range(3):
                # 00356,3556,3566-00578,5778,5788
                for j in range(2,5):
                    if (hand_array[i, j]==1 and hand_array[i, j+1]==0 and hand_array[i, j+2]!=0 and hand_array[i, j+3]==1 and hand_array[i, j-1]==0 and hand_array[i, j-2]==0) or (hand_array[i, j]==1 and hand_array[i, j+1]==0 and hand_array[i, j+2]==1 and hand_array[i, j+3]!=0 and hand_array[i, j-1]==0 and hand_array[i, j-2]==0):
                        hand_array_else_second.append([i, j])
                # 235,2335,223500-457,4557,445700
                for j in range(4,7):
                    if (hand_array[i, j]==1 and hand_array[i, j+1]==0 and hand_array[i, j+2]==0 and hand_array[i, j-1]==0 and hand_array[i, j-2]!=0 and hand_array[i, j-3]==1) or (hand_array[i, j]==1 and hand_array[i, j+1]==0 and hand_array[i, j+2]==0 and hand_array[i, j-1]==0 and hand_array[i, j-2]==1 and hand_array[i, j-3]!=0):
                        hand_array_else_second.append([i, j])

            for i in range(3):
                # 0204
                if hand_array[i,1]==1 and hand_array[i,0]==0 and hand_array[i,2]==0 and hand_array[i,3]==1:
                    hand_array_else_second.append([i, 1])
                # 0806
                if hand_array[i,7]==1 and hand_array[i,8]==0 and hand_array[i,6]==0 and hand_array[i,5]==1:
                    hand_array_else_second.append([i, 7])

            for i in range(3):
                # (2)0305-(2)0709
                for j in range(2, 7):
                    if hand_array[i,j]==1 and hand_array[i,j+1]==0 and hand_array[i,j+2]==1 and hand_array[i,j-1]==0 and hand_array[i,j-2]!=2:
                        hand_array_else_second.append([i,j])
                # (2)0705-(2)0402
                for j in range(6, 3, -1):
                    if hand_array[i,j]==1 and hand_array[i,j+1]==0 and hand_array[i,j+2]!=2 and hand_array[i,j-1]==0 and hand_array[i,j-2]==1:
                        hand_array_else_second.append([i,j])

                # 023340-067780 连上面# 第三优先级提上来的  12230和07889打2和8
                # for j in range(2, 7):
                #     if hand_array[i,j]==2 and hand_array[i,j+1]==1 and hand_array[i,j+2]==0 and hand_array[i,j-1]==1 and hand_array[i,j-2]==0:
                #         hand_array_else_second.append([i, j])

            # 第三优先级 对子间距1位置0 间距2位置1  再加上最后优先级 133和122是等同优先级
            for i in range(3):
                # 加的最后优先级 11200
                if hand_array[i, 0] == 2 and hand_array[i, 1] == 1 and hand_array[i, 2] == 0 and hand_array[i,3]==0:
                    hand_array_else_third.append([i, 1])
                # 加的最后优先级 99800
                if hand_array[i, 8] == 2 and hand_array[i, 7] == 1 and hand_array[i, 6] == 0 and hand_array[i,5]==0:
                    hand_array_else_third.append([i, 7])

                # 6680
                if hand_array[i, 8] == 0 and hand_array[i, 7] == 1 and hand_array[i, 6] == 0 and hand_array[i, 5] == 2:
                    hand_array_else_third.append([i, 7])
                # 0244
                if hand_array[i,1]==1 and hand_array[i,2]==0 and hand_array[i,3]==2 and hand_array[i,0]==0:
                    hand_array_else_third.append([i, 1])

            # 0300-0700 or 0030-0070
            for x in range(3):
                for j in range(2, 7):
                    if (hand_array[x, j] == 1 and hand_array[x, j + 1] == 0 and hand_array[x, j + 2] == 0 and hand_array[x, j - 1] == 0) or (hand_array[x, j] == 1 and hand_array[x, j - 1] == 0 and hand_array[x, j - 2] == 0 and hand_array[x, j + 1] == 0):
                        hand_array_else_third.append([x, j])

            for i in range(3):
                # 0355
                if hand_array[i,2]==1 and hand_array[i,3]==0 and hand_array[i,4]==2 and hand_array[i,1]==0:
                    hand_array_else_third.append([i,2])
                # 5570
                if hand_array[i,4]==2 and hand_array[i,5]==0 and hand_array[i,6]==1 and hand_array[i,7]==0:
                    hand_array_else_third.append([i,6])
                # 0466-0799or123466-456799
                for j in range(3, 7):
                    if (hand_array[i,j]==1 and hand_array[i,j+1]==0 and hand_array[i,j+2]==2 and hand_array[i,j-1]==0) or (hand_array[i,j]==1 and hand_array[i,j+1]==0 and hand_array[i,j+2]==2 and hand_array[i,j-1]==1 and hand_array[i,j-2]==1 and hand_array[i,j-3]==1):
                            hand_array_else_third.append([i,j])
                # 1130-4460or113456-446789
                for j in range(0, 4):
                    if (hand_array[i,j]==2 and hand_array[i,j+1]==0 and hand_array[i,j+2]==1 and hand_array[i,j+3]==0) or (hand_array[i,j]==2 and hand_array[i,j+1]==0 and hand_array[i,j+2]==1 and hand_array[i,j+3]==1 and hand_array[i,j+4]==1 and hand_array[i,j+5]==1):
                            hand_array_else_third.append([i,j+2])

            for i in range(3):
                # 11230,07899
                if hand_array[i,0]==2 and hand_array[i,1]==1 and hand_array[i,2]==1 and hand_array[i,3]==0:
                    hand_array_else_third.append([i,0])
                if hand_array[i,8]==2 and hand_array[i,7]==1 and hand_array[i,6]==1 and hand_array[i,5]==0:
                    hand_array_else_third.append([i,8])
            for i in range(3):
                # 0678899 067880
                if hand_array[i,8]!=1 and hand_array[i,7]==2 and hand_array[i,6]==1 and hand_array[i,5]==1 and hand_array[i,4]==0:
                    hand_array_else_third.append([i,7])
                # 123300-567700
                for j in range(0,5):
                    if hand_array[i,j]==1 and hand_array[i,j+1]==1 and hand_array[i,j+2]==2 and hand_array[i,j+3]==0 and hand_array[i,j+4]!=1:
                        hand_array_else_third.append([i,j+2])
                # 007789-003345
                for j in range(2, 7):
                    if hand_array[i,j]==2 and hand_array[i,j+1]==1 and hand_array[i,j+2]==1 and hand_array[i,j-1]==0 and hand_array[i,j-2]!=1:
                        hand_array_else_third.append([i, j])
                # 023340-067780
                for j in range(2, 7):
                    if hand_array[i,j]==2 and hand_array[i,j+1]==1 and hand_array[i,j+2]==0 and hand_array[i,j-1]==1 and hand_array[i,j-2]==0:
                        hand_array_else_third.append([i, j])

            # 最后优先级 对子间距1位置1 对子为0178放到第三优先级
            for i in range(3):
                #  1223~7889
                for j in range(1, 8):
                    if hand_array[i,j]==2 and hand_array[i,j-1]==1 and hand_array[i,j+1]==1:
                        hand_array_else_last.append([i,j])

                # 连2 230-780
                # for j in range(2, 7):
                #     if (hand_array[i,j]==1 and hand_array[i,j+1]==1 and hand_array[i,j+2]==0) or (hand_array[i,j]==1 and hand_array[i,j-1]==1 and hand_array[i,j-2]==0):
                #         hand_array_else_last.append([i,j])

            for i in range(3):
                # 02330和07780
                if hand_array[i,0]==0 and hand_array[i,1]==1 and hand_array[i,2]==2 and hand_array[i,3]==0:
                    hand_array_else_last.append([i,1])
                if hand_array[i,5]==0 and hand_array[i,6]==2 and hand_array[i,7]==1 and hand_array[i,8]==0:
                    hand_array_else_last.append([i,7])
            for i in range(3):
                # 3440-7880or0223-0667
                for j in range(2, 7):
                    if (hand_array[i,j]==1 and hand_array[i,j+1]==2 and hand_array[i,j+2]==0) or (hand_array[i,j]==1 and hand_array[i,j-1]==2 and hand_array[i,j-2]==0):
                            hand_array_else_last.append([i,j])

            # 判断是否为空 做出出牌选择
            hand_else = []
            if hand_array_else_first != []:
                print('Fan_fou_basic第一级弃牌选择',hand_array_else_first)
                for i in range(len(hand_array_else_first)):
                    if discard_history[hand_array_else_first[i][0],hand_array_else_first[i][1]] > 0:
                        print("Fan_fou_basic打的牌是第一级" , hand_array_else_first[i])
                        self._conv_req_mess('Discard', self._get_card_str(hand_array_else_first[i][0], hand_array_else_first[i][1]), '')
                        put = self._discard_hou(hand_array_else_first[i][0], hand_array_else_first[i][1])
                        return put
                print("Fan_fou_basic打的牌是第一级(%d,%d)" %(hand_array_else_first[0][0], hand_array_else_first[0][1]))
                self._conv_req_mess('Discard', self._get_card_str(hand_array_else_first[0][0], hand_array_else_first[0][1]), '')
                put = self._discard_hou(hand_array_else_first[0][0], hand_array_else_first[0][1])
                return put
            elif hand_array_else_second != []:
                print('Fan_fou_basic第二级弃牌选择',hand_array_else_second)
                for i in range(len(hand_array_else_second)):
                    if discard_history[hand_array_else_second[i][0], hand_array_else_second[i][1]] > 0:
                        print("Fan_fou_basic打的牌是第二级" , hand_array_else_second[i])
                        self._conv_req_mess('Discard', self._get_card_str(hand_array_else_second[i][0], hand_array_else_second[i][1]), '')
                        put = self._discard_hou(hand_array_else_second[i][0], hand_array_else_second[i][1])
                        return put
                print("Fan_fou_basic打的牌是第二级(%d,%d)" %(hand_array_else_second[0][0], hand_array_else_second[0][1]))
                self._conv_req_mess('Discard', self._get_card_str(hand_array_else_second[0][0], hand_array_else_second[0][1]), '')
                put = self._discard_hou(hand_array_else_second[0][0], hand_array_else_second[0][1])
                return put
            elif hand_array_else_third != []:
                print('Fan_fou_basic第三级弃牌选择',hand_array_else_third)
                for i in range(len(hand_array_else_third)):
                    if discard_history[hand_array_else_third[i][0], hand_array_else_third[i][1]] > 0:
                        print("Fan_fou_basic打的牌是第三级" , hand_array_else_third[i])
                        self._conv_req_mess('Discard', self._get_card_str(hand_array_else_third[i][0], hand_array_else_third[i][1]), '')
                        put = self._discard_hou(hand_array_else_third[i][0], hand_array_else_third[i][1])
                        return put
                print("Fan_fou_basic打的牌是第三级(%d,%d)" %(hand_array_else_third[0][0], hand_array_else_third[0][1]))
                self._conv_req_mess('Discard', self._get_card_str(hand_array_else_third[0][0], hand_array_else_third[0][1]), '')
                put = self._discard_hou(hand_array_else_third[0][0], hand_array_else_third[0][1])
                return put
            elif hand_array_else_last != []:
                print('Fan_fou_basic第四级弃牌选择',hand_array_else_last)
                for i in range(len(hand_array_else_last)):
                    if discard_history[hand_array_else_last[i][0], hand_array_else_last[i][1]] > 0:
                        print("Fan_fou_basic打的牌是第四级" , hand_array_else_last[i])
                        self._conv_req_mess('Discard', self._get_card_str(hand_array_else_last[i][0], hand_array_else_last[i][1]), '')
                        put = self._discard_hou(hand_array_else_last[i][0], hand_array_else_last[i][1])
                        return put
                print("Fan_fou_basic打的牌是第四级(%d,%d)" %(hand_array_else_last[0][0], hand_array_else_last[0][1]))
                self._conv_req_mess('Discard', self._get_card_str(hand_array_else_last[0][0], hand_array_else_last[0][1]), '')
                put = self._discard_hou(hand_array_else_last[0][0], hand_array_else_last[0][1])
                return put
            else:
                for i in range(3):
                    for j in range(1,7):
                        if (hand_array[i][j]==1 and hand_array[i][j+1]==1 and hand_array[i][j-1]==0 and hand_array[i][j+2]==0 and discard_history[i][j-1]>0) or (hand_array[i][j]==1 and hand_array[i][j+1]==1 and hand_array[i][j-1]==0 and hand_array[i][j+2]==0 and discard_history[i][j+2]>0):
                            hand_else.append([i,j])
                print('Fan_fou_basic 连牌没有打出去的牌',hand_else)
                for i in range(3):
                    for j in range(1,7):
                        if hand_array[i][j]==1 and hand_array[i][j+1]==1 and hand_array[i][j-1]==0 and hand_array[i][j+2]==0:
                            hand_else.append([i,j])
                print('Fan_fou_basic 连牌打出去的牌',hand_else)
                put = choice(self.majiang)
                i, j = self._get_array_index(put)
                hand_else.append([i,j])
                print('Fan_fou_basic 没有打出去的牌',hand_else)
                put = self._discard_hou(hand_else[0][0], hand_else[0][1])
                return put

        except Exception as e:
            print(e)

    def _discard_hou(self,i ,j):
        print('当前Fan_fou_basic玩家{}的手牌以及矩阵是{}'.format(self.player_seat, self.majiang))
        print(self.StateData[self.player_seat, 0])
        put = self._get_card_cod(i,j)
        MahJong_NO_State_Base.history.append('{},Discard,{}'.format(self.player_seat, self._get_card_str(i,j)))
        print('Fan_fou_basic选手Now_deal的原始值是', MahJong_NO_State_Base.Now_deal)
        MahJong_NO_State_Base.Now_deal = self._get_card_str(i,j)
        print('Fan_fou_basic选手Now_deal的弃牌后的值是', MahJong_NO_State_Base.Now_deal)
        self.StateData[self.player_seat, 0, i, j] -= 1
        # self.showcount[i, j] -= 1
        MahJong_NO_State_Base.ShowCount[i, j] += 1
        self.majiang.remove(put)
        print('Fan_fou_basic玩家{}移除后的手牌是{}'.format(self.player_seat,self.majiang))
        return put
