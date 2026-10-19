class MahJong_NO_State_Base():
    '''
    麻将无状态AI基类
    '''

    # def __init__(self, mess_data):
    #     # 解析出来的消息字典
    #     self.MessData = json.loads(mess_data)
    #     # 返回的消息字典，需要转化为json
    #     self.__init_state()

    # def __init_state(self):
    Now_deal = ''
    history = []
    ShowCount = np.zeros(shape=(4, 9), dtype=np.int8)
    def __init__(self, seat, majiang_own):
        '''
        初始化当前的状态
        :return:
        '''
        # 返回的数据
        # self.ReqMess = {}
        # 存储游戏玩家所有的状态数据
        self.StateData = np.zeros(shape=(4, 7, 4, 9), dtype=np.int8)
        # 游戏当前的特殊牌
        self.Game_Special = ''
        # 游戏玩家当前处理的牌
        # MahJong_NO_State_Base.Now_deal = ''
        # 自己杠牌分组的统计
        self.gang_count = 0
        # 判断是否是天听
        self.is_tting = True
        # 暗杠牌的统计
        self.gang_count_an = 0
        # 所有已知牌的统计
        # self.ShowCount = np.zeros(shape=(4, 9), dtype=np.int8)
        MahJong_NO_State_Base.ShowCount = np.zeros(shape=(4, 9), dtype=np.int8)
        # 当前决策者的座位号
        self.player_seat = seat
        # self.player_seat = -1
        # 用于存储合法动作序列
        self.legal_action = {}
        # 牌普记录
        # self.history = []
        MahJong_NO_State_Base.history = []
        # self.angang = []
        # self.minggang = []
        self.gang = []
        self.peng = []
        self.chi = []
        #
        self.majiang = majiang_own
        # 分析提取数据
        self._organize()
        # self._analyze_game_data()
        # logging.debug(self.ShowCount)

    def _organize(self):
        # print('玩家{}的起手牌是{}'.format(seat, majiang))
        print('玩家{}的起手牌是{}'.format(self.player_seat, self.majiang))
        for i in range(13):
            line, row = self._get_array_index(self.majiang[i])
            self.StateData[self.player_seat, 0, line, row] += 1
            # MahJong_NO_State_Base.ShowCount[line, row] += 1
            # self.majiang.pop(0)
        print('玩家{}的起手牌矩阵是{}\n'.format(self.player_seat, self.StateData[self.player_seat, 0]))

    def get_new_majiang(self, seat, majiang):
        """确定庄家，获得一张牌，开始游戏"""
        # print('玩家{}获得一张牌前的手牌{}以及手牌矩阵是'.format(seat, self.majiang))
        # print(self.StateData[seat, 0])
        self.majiang.append(majiang)
        line, row = self._get_array_index(majiang)
        self.StateData[seat, 0, line, row] += 1
        # if self.player_seat == 0:
        #     MahJong_NO_State_Base.ShowCount[line, row] += 1
        # print('玩家{}获得一张牌后的手牌{}以及手牌矩阵是'.format(seat, self.majiang))
        # print(self.StateData[seat, 0])
        # print('获得一张牌后的矩阵是{}'.format(self.StateData[self.player_seat, 0]))
        # majiang.pop(0)
        # print('给一张牌后剩余牌数量', len(majiang))
        # return self.del_ourself_drw()

    def _check_card_legal(self, card_list):
        '''
        判断列表中的牌字符串是否合法
        :param card_list:
        :return:
        '''
        for card in card_list:
            if card not in card_set:
                logging.error("牌表示出错:%s", card)
                exit()

    def _get_card_index(self, card):
        '''
        获得字符串形式牌的索引
        :param card:
        :return:
        '''
        if card == 'UN':
            logging.error('UN')
        line = -1
        row = -1
        card_str = self._cut_string(card, 1)
        if card_str[0] == 'C' or card_str[0] == 'B' or card_str[0] == 'D':
            row = int(card_str[1]) - 1
            if row > 9:
                logging.error('牌的编码错误')
                exit()
            if card_str[0] == 'B':
                line = 0
            elif card_str[0] == 'C':
                line = 1
            elif card_str[0] == 'D':
                line = 2
        elif card_str[0] == 'W' or card_str[0] == 'A':
            line = 3
            if card_str[1] == 'E':
                row = 0
            elif card_str[1] == 'W':
                row = 1
            elif card_str[1] == 'S':
                row = 2
            elif card_str[1] == 'N':
                row = 3
            elif card_str[1] == 'C':
                row = 4
            elif card_str[1] == 'F':
                row = 5
            elif card_str[1] == 'B':
                row = 6
        else:
            print("牌的编码为",card_str)
            logging.error('牌的编码错误')
            exit()
        return line, row

    def _full_array(self, seat, feature_index, str_list):
        '''
        填充数据矩阵
        :param seat: 要填充的玩家座位0~3
        :param feature_index: 要填充的特征0~6
        :param str_list: 要填充的牌的字符串列表
        :return:
        '''
        for card in str_list:
            line, row = self._get_card_index(card)
            if feature_index == 0:
                self.ShowCount[line, row] += 1
            self.StateData[seat, feature_index, line, row] += 1

    def _cut_string(self, text, lenth):
        '''
        按照指定长度分割字符串
        :param text: 字符串
        :param lenth: 分割长度
        :return:
        '''
        textArr = re.findall(r'.{' + str(lenth) + '}', text)
        if text[(len(textArr) * lenth):] != "":
            textArr.append(text[(len(textArr) * lenth):])
        return textArr

    def _get_card_str(self, line, row):
        '''
        根据牌的行列，得到牌的字符串表示
        :param line:
        :param row:
        :return:
        '''
        card_str = ''
        if line == 0:
            card_str += 'B'
            card_str += str(row + 1)
        elif line == 1:
            card_str += 'C'
            card_str += str(row + 1)
        elif line == 2:
            card_str += 'D'
            card_str += str(row + 1)
        elif line == 3:
            if row == 0:
                card_str = 'WE'
            elif row == 1:
                card_str = 'WW'
            elif row == 2:
                card_str = 'WS'
            elif row == 3:
                card_str = 'WN'
            elif row == 4:
                card_str = 'AC'
            elif row == 5:
                card_str = 'AF'
            elif row == 6:
                card_str = 'AB'

        return card_str

    def _get_array_index(self, index):
        '''
        根据牌的编码索引，获取牌在矩阵中的位置， 0~34
        :param index:
        :return:
        '''
        line = index // 9
        row = index % 9
        return line, row

    def _get_card_cod(self, line, row):
        '''
        根据矩阵中的索引，得到牌的编码
        :param line:
        :param row:
        :return:
        '''
        index = line * 9 + row
        return index

    def _check_random_gang(self, seat, is_self=True):
        '''
        判断玩家是否可以杠牌
        :param seat:
        :param is_self:
        :return:
        '''
        gang_count = []
        check_count = 0
        if is_self:
            for line in range(4):
                for row in range(9):
                    check_count += 1
                    if self.StateData[seat, 0, line, row] == 4:
                        gang_count.append([line, row])
                        # index_zh = self._get_card_str(line, row)
                        # self.history.append('{}"Kon"{}'.format(self.player_seat, index_zh))
                    # if self.StateData[seat, 0, line, row] == 1 and self.StateData[seat, 2, line, row] == 1:
                    #     gang_count.append([line, row])
                    #     index_zh = self._get_card_str(line, row)
                    #     self.history.append('{}"Kon"{}'.format(self.player_seat, index_zh))
        else:
            if MahJong_NO_State_Base.Now_deal == '-1':
                logging.error('动作序列判断错误')
                exit()
            print(MahJong_NO_State_Base.Now_deal)
            now_line, now_row = self._get_card_index(MahJong_NO_State_Base.Now_deal)
            if self.StateData[seat, 0, now_line, now_row] == 3:
                gang_count.append([now_line, now_row])
                # index_zh = self._get_card_str(now_line, now_row)
                # self.history.append('{}"Kon"{}'.format(self.player_seat, index_zh))

        if len(gang_count) == 0:
            return False, None
        else:
            return True, gang_count

    def _check_gang(self, seat, is_self=True):
        '''
        判断玩家是否可以杠牌
        :param seat:
        :param is_self:
        :return:
        '''
        gang_count = []
        check_count = 0
        # pon_hand_card = self.MessData['pon_hand']
        # print(pon_hand_card)
        if is_self:
            for line in range(4):
                for row in range(9):
                    check_count += 1
                    if self.StateData[seat, 0, line, row] == 4:
                        gang_count.append([line, row])
                        # index_zh = self._get_card_str(line, row)
                        # self.history.append('{}"Kon"{}'.format(self.player_seat, index_zh))
                    # if self.StateData[seat, 0, line, row] == 1 and self.StateData[seat, 2, line, row] == 1:
                    #     gang_count.append([line, row])
                    #     index_zh = self._get_card_str(line, row)
                    #     self.history.append('{}"Kon"{}'.format(self.player_seat, index_zh))
                    # 补杠
                    # pon_hand_card = self.MessData['pon_hand']
                    # if pon_hand_card != "":
                    #     now_line, now_row = self._get_card_index(pon_hand_card[0:2])
                    #     if self.StateData[seat, 0, now_line, now_row] == 1:
                    #         gang_count.append([now_line, now_row])
                    #     if len(pon_hand_card) > 6:
                    #         now_line, now_row = self._get_card_index(pon_hand_card[7:9])
                    #         if self.StateData[seat, 0, now_line, now_row] == 1:
                    #             gang_count.append([now_line, now_row])
                    #     if len(pon_hand_card) > 13:
                    #         now_line, now_row = self._get_card_index(pon_hand_card[14:16])
                    #         if self.StateData[seat, 0, now_line, now_row] == 1:
                    #             gang_count.append([now_line, now_row])
                    #     if len(pon_hand_card) > 20:
                    #         now_line, now_row = self._get_card_index(pon_hand_card[21:23])
                    #         if self.StateData[seat, 0, now_line, now_row] == 1:
                    #             gang_count.append([now_line, now_row])
        else:
            if MahJong_NO_State_Base.Now_deal == '-1':
                logging.error('动作序列判断错误')
                exit()
            now_line, now_row = self._get_card_index(MahJong_NO_State_Base.Now_deal)
            if self.StateData[seat, 0, now_line, now_row] == 3:
                gang_count.append([now_line, now_row])
                # index_zh = self._get_card_str(now_line, now_row)
                # self.history.append('{}"Kon"{}'.format(self.player_seat, index_zh))
            # 补杠
            # if self.StateData[seat, 0, now_line, now_row] == 1 and self.StateData[seat, 2, now_line, now_row] == 3:
            #     gang_count.append([now_line, now_row])
                # index_zh = self._get_card_str(now_line, now_row)
                # self.history.append('{}"Kon"{}'.format(self.player_seat, index_zh))

        if len(gang_count) == 0:
            return False, None
        else:
            return True, gang_count

    def _check_peng(self, seat):
        '''
        判断碰牌
        :param seat:
        :return:
        '''
        peng_count = []
        now_line, now_row = self._get_card_index(MahJong_NO_State_Base.Now_deal)
        if self.StateData[seat, 0, now_line, now_row] == 2:
            peng_count.append([now_line, now_row])
            # index_zh = self._get_card_str(now_line, now_row)
            # self.history.append('{}"Pon"{}'.format(self.player_seat, index_zh))
        if len(peng_count) == 0:
            return False, None
        else:
            return True, peng_count

    def _check_random_chi(self, seat):
        '''
        判断吃牌
        :param seat:
        :return:
        '''
        chi_count = []
        now_line, now_row = self._get_card_index(MahJong_NO_State_Base.Now_deal)
        if now_line == 3:
            return False, None
        anRelateIndex = [-1, -1, -1, -1]
        if now_row - 2 >= 0:
            anRelateIndex[0] = self.StateData[seat, 0, now_line, now_row - 2]
        if now_row - 1 >= 0:
            anRelateIndex[1] = self.StateData[seat, 0, now_line, now_row - 1]
        if now_row + 1 <= 8:
            anRelateIndex[2] = self.StateData[seat, 0, now_line, now_row + 1]
        if now_row + 2 <= 8:
            anRelateIndex[3] = self.StateData[seat, 0, now_line, now_row + 2]
        for i in range(now_row-2,now_row+3):
            if anRelateIndex[now_row]==0:
                if anRelateIndex[i] == 1 and anRelateIndex[i + 1] == 1:
                    if i == 0:
                        chi_count.append([now_line, now_row - 2])
                    elif i == 1:
                        chi_count.append([now_line, now_row - 1])
                    elif i == 2:
                        chi_count.append([now_line, now_row])
                    elif i == 3:
                        chi_count.append([now_line, now_row+1])
                if (anRelateIndex[i] == 2 and anRelateIndex[i + 1] == 1) or (anRelateIndex[i] == 1 and anRelateIndex[i + 1] == 2):
                    if i == 0:
                        chi_count.append([now_line, now_row - 2])
                    elif i == 1:
                        chi_count.append([now_line, now_row - 1])
                    elif i == 2:
                        chi_count.append([now_line, now_row])
                    elif i == 3:
                        chi_count.append([now_line, now_row+1])

        # 单牌吃
        # for i in range(3):
        #     if anRelateIndex[i] != 0 and anRelateIndex[i + 1] != 0:
        #         if i == 0:
        #             chi_count.append([now_line, now_row - 2])
        #             # index = self._get_card_cod(now_line, now_row-2)
        #             # self.history.append('{}"Chi"{}'.format(self.player_seat, index_chi[index]))
        #         elif i == 1:
        #             chi_count.append([now_line, now_row - 1])
        #             # index = self._get_card_cod(now_line, now_row-1)
        #             # self.history.append('{}"Chi"{}'.format(self.player_seat, index_chi[index]))
        #         elif i == 2:
        #             chi_count.append([now_line, now_row])
        #             # index = self._get_card_cod(now_line, now_row)
        #             # self.history.append('{}"Chi"{}'.format(self.player_seat, index_chi[index]))
        if len(chi_count) == 0:
            return False, None
        else:
            return True, chi_count

    def _check_chi(self, seat):
        '''
        判断吃牌
        :param seat:
        :return:
        '''
        chi_count = []
        chi_count_one = []
        chi_count_two = []
        chi_count_three = []
        now_line, now_row = self._get_card_index(MahJong_NO_State_Base.Now_deal)
        if now_line == 3:
            return False, None
        anRelateIndex = [-1, -1, -1, -1]
        if now_row - 2 >= 0:
            anRelateIndex[0] = self.StateData[seat, 0, now_line, now_row - 2]
        if now_row - 1 >= 0:
            anRelateIndex[1] = self.StateData[seat, 0, now_line, now_row - 1]
        # anRelateIndex[2] = self.StateData[seat, 0, now_line, now_row]
        if now_row + 1 <= 8:
            anRelateIndex[2] = self.StateData[seat, 0, now_line, now_row + 1]
        if now_row + 2 <= 8:
            anRelateIndex[3] = self.StateData[seat, 0, now_line, now_row + 2]
        print('anRelateIndex的值：',anRelateIndex)
        # for i in range(now_row-2,now_row+3):
        #     if anRelateIndex[now_row]==0:
        #         if anRelateIndex[i] == 1 and anRelateIndex[i + 1] == 1:
        #             if i == 0:
        #                 chi_count.append([now_line, now_row - 2])
        #             elif i == 1:
        #                 chi_count.append([now_line, now_row - 1])
        #             elif i == 2:
        #                 chi_count.append([now_line, now_row])
        #             elif i == 3:
        #                 chi_count.append([now_line, now_row+1])
        #         if (anRelateIndex[i] == 2 and anRelateIndex[i + 1] == 1) or (anRelateIndex[i] == 1 and anRelateIndex[i + 1] == 2):
        #             if i == 0:
        #                 chi_count.append([now_line, now_row - 2])
        #             elif i == 1:
        #                 chi_count.append([now_line, now_row - 1])
        #             elif i == 2:
        #                 chi_count.append([now_line, now_row])
        #             elif i == 3:
        #                 chi_count.append([now_line, now_row+1])

        # 单牌吃
        for i in range(3):
            # 两张单牌吃
            if anRelateIndex[i] == 1 and anRelateIndex[i + 1] == 1:
                if i == 0:
                    chi_count_one.append([now_line, now_row - 2])
                    # index = self._get_card_cod(now_line, now_row-2)
                    # self.history.append('{}"Chi"{}'.format(self.player_seat, index_chi[index]))
                elif i == 1:
                    chi_count_one.append([now_line, now_row - 1])
                    # index = self._get_card_cod(now_line, now_row-1)
                    # self.history.append('{}"Chi"{}'.format(self.player_seat, index_chi[index]))
                elif i == 2:
                    chi_count_one.append([now_line, now_row])
                    # index = self._get_card_cod(now_line, now_row)
                    # self.history.append('{}"Chi"{}'.format(self.player_seat, index_chi[index]))
            # 一个对子吃
            if (anRelateIndex[i] == 2 and anRelateIndex[i + 1] == 1) or (anRelateIndex[i] == 1 and anRelateIndex[i + 1] == 2):
                if i == 0:
                    chi_count_two.append([now_line, now_row - 2])
                    # index = self._get_card_cod(now_line, now_row-2)
                    # self.history.append('{}"Chi"{}'.format(self.player_seat, index_chi[index]))
                elif i == 1:
                    chi_count_two.append([now_line, now_row - 1])
                    # index = self._get_card_cod(now_line, now_row-1)
                    # self.history.append('{}"Chi"{}'.format(self.player_seat, index_chi[index]))
                elif i == 2:
                    chi_count_two.append([now_line, now_row])
                    # index = self._get_card_cod(now_line, now_row)
                    # self.history.append('{}"Chi"{}'.format(self.player_seat, index_chi[index]))
            # 两个对子吃
            if anRelateIndex[i] == 2 and anRelateIndex[i + 1] == 2:
                if i == 0:
                    chi_count_three.append([now_line, now_row - 2])
                    # index = self._get_card_cod(now_line, now_row-2)
                    # self.history.append('{}"Chi"{}'.format(self.player_seat, index_chi[index]))
                elif i == 1:
                    if self.StateData[seat, 0, now_line, now_row] ==1:
                        chi_count_three.append([now_line, now_row - 1])
                        # index = self._get_card_cod(now_line, now_row-1)
                        # self.history.append('{}"Chi"{}'.format(self.player_seat, index_chi[index]))
                    elif now_row > 2 and now_row < 6:
                        if (self.StateData[seat, 0, now_line, now_row - 2]==1 and self.StateData[seat, 0, now_line, now_row - 3]==1 and self.StateData[seat, 0, now_line, now_row + 2]==1) or (self.StateData[seat, 0, now_line, now_row + 2]==1 and self.StateData[seat, 0, now_line, now_row + 3]==1 and self.StateData[seat, 0, now_line, now_row - 2]==1):
                            chi_count_three.append([now_line, now_row - 1])
                            # index = self._get_card_cod(now_line, now_row-1)
                            # self.history.append('{}"Chi"{}'.format(self.player_seat, index_chi[index]))
                elif i == 2:
                    chi_count_three.append([now_line, now_row])
                    # index = self._get_card_cod(now_line, now_row)
                    # self.history.append('{}"Chi"{}'.format(self.player_seat, index_chi[index]))
        # print("第一级")
        # print(chi_count_one)
        # print("第二级")
        # print(chi_count_two)
        # print("第三级")
        # print(chi_count_three)
        chi_count = chi_count_one + chi_count_two + chi_count_three
        if len(chi_count) == 0:
            return False, None, None, None, None
        else:
            return True, chi_count, chi_count_one, chi_count_two, chi_count_three

    def _check_ting(self, seat, t_ting=False):
        '''
        通用检查玩家是否可以听
        :param seat:
        :param t_ting:
        :return:
        '''
        ting_count = {}
        hand_array = copy.deepcopy(self.StateData[seat, 0])
        if t_ting:
            ting_count[-1] = []
            for i in range(card_kind):
                line, row = self._get_array_index(i)
                hand_array = copy.deepcopy(self.StateData[seat, 0])
                hand_array[line, row] += 1
                is_hu, hu_value = self._check_hu(hand_array)
                if is_hu:
                    ting_count[-1].append(dict_index[i])
            if len(ting_count[-1]) == 0:
                ting_count.pop(-1)
        else:
            for i in range(card_kind):
                line, row = self._get_array_index(i)
                if hand_array[line, row] == 0:
                    continue
                temp_hand_array = copy.deepcopy(self.StateData[seat, 0])
                temp_hand_array[line, row] -= 1
                ting_count[dict_index[i]] = []
                for j in range(card_kind):
                    temp_hand = copy.deepcopy(temp_hand_array)
                    now_line, mow_row = self._get_array_index(j)
                    temp_hand[now_line, mow_row] += 1
                    is_hu, _ = self._check_hu(temp_hand)
                    if is_hu:
                        ting_count[dict_index[i]].append(dict_index[j])
                if len(ting_count[dict_index[i]]) == 0:
                    ting_count.pop(dict_index[i])
        if len(ting_count) == 0:
            return False, None
        return True, ting_count

        # 以下函数需要子类继承实现的函数

    # def check_ting(self, seat, t_ting=False):
    #     '''
    #     通用检查玩家是否可以听
    #     :param seat:
    #     :param t_ting:
    #     :return:
    #     '''
    #     ting_count = {}
    #     hand_array = copy.deepcopy(self.StateData[seat, 0])
    #     if t_ting:
    #         ting_count[-1] = []
    #         for i in range(card_kind):
    #             line, row = self._get_array_index(i)
    #             hand_array = copy.deepcopy(self.StateData[seat, 0])
    #             hand_array[line, row] += 1
    #             is_hu, hu_value = self._check_hu(hand_array)
    #             if is_hu:
    #                 ting_count[-1].append(dict_index[i])
    #         if len(ting_count[-1]) == 0:
    #             ting_count.pop(-1)
    #     else:
    #         for i in range(card_kind):
    #             line, row = self._get_array_index(i)
    #             if hand_array[line, row] == 0:
    #                 continue
    #             temp_hand_array = copy.deepcopy(self.StateData[seat, 0])
    #             temp_hand_array[line, row] -= 1
    #             ting_count[dict_index[i]] = []
    #             for j in range(card_kind):
    #                 temp_hand = copy.deepcopy(temp_hand_array)
    #                 now_line, mow_row = self._get_array_index(j)
    #                 temp_hand[now_line, mow_row] += 1
    #                 is_hu, _ = self._check_hu(temp_hand)
    #                 if is_hu:
    #                     ting_count[dict_index[i]].append(dict_index[j])
    #             if len(ting_count[dict_index[i]]) == 0:
    #                 ting_count.pop(dict_index[i])
    #     if len(ting_count) == 0:
    #         return False, None
    #     return True, ting_count
    #
    #     # 以下函数需要子类继承实现的函数

    def _check_hu(self, hand_array):
        '''
        通用判断胡牌
        :param seat:
        :return:
        '''
        hand_group = self._cont_hu_list(hand_array)
        hu_key = self._call_key(hand_group)
        if hu_key in HuTable.keys():
            return True, HuTable[hu_key]
        return False, None

    def _cont_hu_list(self, hand_array):
        '''
        将手牌的统计，装换为，可以计算key的形式的列表
        :param seat:
        :return:
        '''
        group = []
        result = []
        for line in range(3):
            for row in range(9):
                if hand_array[line, row] != 0:
                    group.append(hand_array[line, row])
                else:
                    if len(group) != 0:
                        result.append(group)
                    group = []
        for row in range(7):
            if hand_array[3, row] != 0:
                result.append([hand_array[3, row]])
        return result

    def _call_key(self, DowList):
        '''
        计算牌型的key值
        :return:
        '''
        index = -1
        ret = 0
        for _, b in enumerate(DowList):
            for _, v in enumerate(b):
                index += 1
                if v == 2:
                    ret |= 0x3 << index
                    index += 2
                elif v == 3:
                    ret |= 0xF << index
                    index += 4
                elif v == 4:
                    ret |= 0x3F << index
                    index += 6
            ret |= 0x1 << index
            index += 1
        return ret

    def _conv_req_mess(self, action_type, action_content='', note=''):
        '''
        组装回复数据
        :param action:
        :return:
        '''
        # self.ReqMess['action_type'] = action_type
        # self.ReqMess['action_content'] = action_content
        # self.ReqMess['note'] = note
        return action_type,action_content

    # def get_game_req(self):
    #     '''
    #     返回游戏的消息
    #     :return:
    #     '''
    #     return self.ReqMess

    # 以下为子类实现的函数

    def ai_del_tting(self):
        card_num = self.StateData[self.player_seat, 0].sum()
        # print('处理逻辑的history',self.history)
        # 天听动作
        if card_num == 13:
            is_can_tting, ting_result = self._check_ting(self.player_seat, t_ting=True)
            # 如果可以天听，并且天听的牌的种类超过两种就天听
            if is_can_tting:
                for key in ting_result.keys():
                    self._conv_req_mess('Listen', key, '')
                    print('玩家{}的天听列表值是{}：'.format(self.player_seat, key))
                    MahJong_NO_State_Base.history.append('{},Listen,{}'.format(self.player_seat, key))
                    return 5
            else:
                self._conv_req_mess('Pass', '', '')
                return -1

    def ai_del_ting(self):
        card_num = self.StateData[self.player_seat, 0].sum()
        # print('处理逻辑的history',self.history)
        is_can_tting, ting_result = self._check_ting(self.player_seat, t_ting=True)
        # 如果可以天听，并且天听的牌的种类超过两种就天听
        if is_can_tting:
            for key in ting_result.keys():
                self._conv_req_mess('Listen', key, '')
                print('玩家{}的听牌列表值是：{}'.format(self.player_seat, ting_result))
                # 可以加判断 去掉已经存在的listen -1
                # history = MahJong_NO_State_Base.history
                # for i in range(len(history)):
                #     if history[i][0] == str(self.player_seat) and history[i][2] == 'L' and history[i][-1] == '-1':
                #         return 5
                MahJong_NO_State_Base.history.append('{},Listen,{}'.format(self.player_seat, key))
            return 5
        else:
            self._conv_req_mess('Pass', '', '')
            return -1

    def ai_del_zihu(self, majiang):
        temp_hand_count = copy.deepcopy(self.StateData[self.player_seat, 0])
        line, row = self._get_array_index(majiang)
        print('当前玩家{}对摸到的牌{}进行判断是否自摸'.format(self.player_seat,majiang))
        # temp_hand_count[line, row] += 1
        # print('---------------',temp_hand_count)
        # if MahJong_NO_State_Base.Now_deal != '':
        #     line1, row1 = self._get_card_index(MahJong_NO_State_Base.Now_deal)
        #     print('处理当前打出的牌以及对应的索引',MahJong_NO_State_Base.Now_deal,line1,row1)
        is_hu, _ = self._check_hu(temp_hand_count)
        logging.debug("自摸胡牌判断：%s", is_hu)
        if is_hu:
            self._conv_req_mess('Win', majiang)
            index_zh = self._get_card_str(line, row)
            MahJong_NO_State_Base.history.append('{},Win,{}'.format(self.player_seat, index_zh))
            print(MahJong_NO_State_Base.history)
            print('玩家{}自摸获胜的手牌{}以及手牌矩阵'.format(self.player_seat, self.majiang))
            print(self.StateData[self.player_seat, 0])
            return 6
        print('不能自摸胡牌，判断是否暗杠')
        return self.ai_del_angang(majiang)

    def ai_del_angang(self, majiang):
        can_gang, gang_count = self._check_gang(self.player_seat, is_self=True)
        if can_gang:
            print('玩家{}暗杠之前的手牌矩阵{}'.format(self.player_seat, self.StateData[self.player_seat, 0]))
            print(gang_count)
            print('玩家{}暗杠之前的手牌是{}'.format(self.player_seat, self.majiang))
            line, row = self._get_array_index(majiang)
            if line == gang_count[0][0] and row == gang_count[0][1]:
                self.StateData[self.player_seat, 0, line, row] = 0
                self.StateData[self.player_seat, 3, line, row] = 4
                # MahJong_NO_State_Base.ShowCount[line, row] = 4
                for i in range(4):
                    self.majiang.remove(majiang)
            else:
                index_gang = self._get_card_cod(gang_count[0][0], gang_count[0][1])
                self.StateData[self.player_seat, 0, gang_count[0][0], gang_count[0][1]] = 0
                self.StateData[self.player_seat, 3, gang_count[0][0], gang_count[0][1]] = 4
                # MahJong_NO_State_Base.ShowCount[gang_count[0][0], gang_count[0][1]] = 4
                for i in range(4):
                    self.majiang.remove(index_gang)
            self._conv_req_mess('Kon', self._get_card_str(gang_count[0][0], gang_count[0][1]) * 4, '')
            MahJong_NO_State_Base.history.append('{},Kon,{}'.format(self.player_seat, self._get_card_str(gang_count[0][0], gang_count[0][1])))
            self.gang.append('{},Kon,{}'.format(self.player_seat, self._get_card_str(gang_count[0][0], gang_count[0][1])))
            # logging.debug(self.ReqMess)
            return 4
        print('不能暗杠，返回弃牌处理')
        return 0

    def ai_del_bugang(self, majiang):
        # 补杠
        if self.peng != "":
            line, row = self._get_array_index(majiang)
            # gang_count = []
            if self.StateData[self.player_seat, 0, line, row] == 1 and self.StateData[self.player_seat, 2, line, row] == 3:
                # gang_count.append([now_line, now_row])
                print('玩家{}补杠之前的碰牌列表{}以及手牌矩阵'.format(self.player_seat, self.peng))
                print(self.StateData[self.player_seat, 0])
                self.StateData[self.player_seat, 0, line, row] = 0
                self.StateData[self.player_seat, 3, line, row] = 4
                # if self.player_seat != 0 or self.player_seat != 1:
                MahJong_NO_State_Base.ShowCount[line, row] += 1
                self.majiang.remove(majiang)
                self._conv_req_mess('Kon', self._get_card_str(line, row) * 4, '')
                print('玩家{}补杠之后的手牌矩阵{}'.format(self.player_seat, self.StateData[self.player_seat, 0]))
                MahJong_NO_State_Base.history.append('{},BuKon,{}'.format(self.player_seat, self._get_card_str(line, row)))
                self.gang.append('{},Kon,{}'.format(self.player_seat, self._get_card_str(line, row)))
                # logging.debug(self.ReqMess)
                print("补杠")
                return 3
        return 0

    def del_ourself_drw(self):
        '''
        处理自己摸牌
        :return:
        '''
        print('当前玩家{}的手牌是{}'.format(self.player_seat, self.majiang))
        put = choice(self.majiang)
        print('玩家{}要移除的手牌序号是{}'.format(self.player_seat,put))
        line, row = self._get_array_index(put)
        index_zh = self._get_card_str(line, row)
        self._conv_req_mess('Discard', index_zh, '')
        MahJong_NO_State_Base.history.append('{},Discard,{}'.format(self.player_seat, index_zh))
        print('MahJong_NO_State_Base.Now_deal的原始值是', MahJong_NO_State_Base.Now_deal)
        MahJong_NO_State_Base.Now_deal = index_zh
        print('MahJong_NO_State_Base.Now_deal的弃牌后的值是', MahJong_NO_State_Base.Now_deal)
        self.StateData[self.player_seat, 0, line, row] -= 1
        MahJong_NO_State_Base.ShowCount[line, row] += 1
        self.majiang.remove(put)
        print('玩家{}移除后的手牌是{}'.format(self.player_seat,self.majiang))
        # print(self.history)
        return put

        # 打最后一张牌
        # for i in [3, 2, 1, 0]:
        #     for j in [8, 7, 6, 5, 4, 3, 2, 1, 0]:
        #         if self.StateData[self.player_seat, 0, i, j] != 0:
        #             self._conv_req_mess('Discard', self._get_card_str(i, j), '')
        #             index = self._get_card_cod(i, j)
        #             index_zh = self._get_card_str(i, j)
        #             self.history.append('{}"Discard"{}'.format(self.player_seat, index_zh))
        #             MahJong_NO_State_Base.Now_deal = index_zh
        #             self.StateData[self.player_seat, 0, i, j] -= 1
        #             print('当前玩家{}的手牌是{}'.format(self.player_seat, self.majiang))
        #             print('玩家{}要移除的手牌序号是{}'.format(self.player_seat,index))
        #             self.majiang.remove(index)
        #             print('移除后的手牌',self.majiang)
        #             # shoupai.remove(index)
        #             print(self.history)
        #             return index_zh

    def del_ting_drw(self, put):
        '''
        听牌后摸啥打啥
        :return:
        '''
        # print('听牌玩家{}的手牌是{}以及矩阵'.format(self.player_seat, self.majiang))
        # print(self.StateData[self.player_seat, 0])
        # put = choice(self.majiang)
        print('听牌玩家{}要移除的手牌序号是{}'.format(self.player_seat,put))
        line, row = self._get_array_index(put)
        index_zh = self._get_card_str(line, row)
        self._conv_req_mess('Listen', index_zh, '')
        MahJong_NO_State_Base.history.append('{},Listen,{}'.format(self.player_seat, index_zh))
        print('MahJong_NO_State_Base.Now_deal的原始值是', MahJong_NO_State_Base.Now_deal)
        MahJong_NO_State_Base.Now_deal = index_zh
        print('MahJong_NO_State_Base.Now_deal的弃牌后的值是', MahJong_NO_State_Base.Now_deal)
        self.StateData[self.player_seat, 0, line, row] -= 1
        # if self.player_seat != 0 or self.player_seat != 1:
        MahJong_NO_State_Base.ShowCount[line, row] += 1
        self.majiang.remove(put)
        print('听牌玩家{}移除后的手牌是{}以及矩阵'.format(self.player_seat,self.majiang))
        print(self.StateData[self.player_seat, 0])
        # print(self.history)
        return

        # 打最后一张牌
        # for i in [3, 2, 1, 0]:
        #     for j in [8, 7, 6, 5, 4, 3, 2, 1, 0]:
        #         if self.StateData[self.player_seat, 0, i, j] != 0:
        #             self._conv_req_mess('Discard', self._get_card_str(i, j), '')
        #             index = self._get_card_cod(i, j)
        #             index_zh = self._get_card_str(i, j)
        #             self.history.append('{}"Discard"{}'.format(self.player_seat, index_zh))
        #             MahJong_NO_State_Base.Now_deal = index_zh
        #             self.StateData[self.player_seat, 0, i, j] -= 1
        #             print('当前玩家{}的手牌是{}'.format(self.player_seat, self.majiang))
        #             print('玩家{}要移除的手牌序号是{}'.format(self.player_seat,index))
        #             self.majiang.remove(index)
        #             print('移除后的手牌',self.majiang)
        #             # shoupai.remove(index)
        #             print(self.history)
        #             return index_zh

    def ai_del_paohu(self, majiang):
        temp_hand_count = copy.deepcopy(self.StateData[self.player_seat, 0])
        line, row = self._get_array_index(majiang)
        print('玩家{}处理当前打出的牌{}'.format(self.player_seat, majiang))
        temp_hand_count[line, row] += 1
        # if MahJong_NO_State_Base.Now_deal != '':
        #     line1, row1 = self._get_card_index(MahJong_NO_State_Base.Now_deal)
        #     print('处理当前打出的牌以及对应的索引',MahJong_NO_State_Base.Now_deal,line1,row1)
        is_hu, _ = self._check_hu(temp_hand_count)
        logging.debug("点炮胡牌判断：%s", is_hu)
        if is_hu:
            print('玩家{}炮胡'.format(self.player_seat))
            self._conv_req_mess('Win', MahJong_NO_State_Base.Now_deal)
            print('玩家{}炮胡之后的手牌矩阵'.format(self.player_seat))
            print(self.StateData[self.player_seat, 0])
            MahJong_NO_State_Base.history.append('{},Win,{}'.format(self.player_seat, MahJong_NO_State_Base.Now_deal))
            print(MahJong_NO_State_Base.history)
            print('玩家{}点炮获胜的手牌{}以及手牌矩阵'.format(self.player_seat, self.majiang))
            print(self.StateData[self.player_seat, 0])
            return 6
        return 0

    def ai_del_minggang(self, majiang):
        can_gang, gang_count = self._check_gang(self.player_seat, is_self=False)
        if can_gang:
            print('玩家{}明杠之前的手牌矩阵{}'.format(self.player_seat, self.StateData[self.player_seat, 0]))
            line, row = self._get_array_index(majiang)
            self.StateData[self.player_seat, 0, line, row] = 0
            self.StateData[self.player_seat, 3, line, row] = 4
            # if self.player_seat != 0 or self.player_seat != 1:
            MahJong_NO_State_Base.ShowCount[line, row] += 3
            for i in range(3):
                self.majiang.remove(majiang)
            self._conv_req_mess('Kon', self._get_card_str(gang_count[0][0], gang_count[0][1]) * 4, '')
            print('玩家{}明杠之后的手牌矩阵{}'.format(self.player_seat, self.StateData[self.player_seat, 0]))
            MahJong_NO_State_Base.history.append('{},Kon,{}'.format(self.player_seat, MahJong_NO_State_Base.Now_deal))
            self.gang.append('{},Kon,{}'.format(self.player_seat, MahJong_NO_State_Base.Now_deal))
            # logging.debug(self.ReqMess)
            print('明杠后返回弃牌处理')
            return 3
            # return self.del_ourself_drw()
        return 0

    def ai_del_peng(self, majiang):
        can_pen, pen_count = self._check_peng(self.player_seat)
        if can_pen:
            print('玩家{}碰之前的手牌{}以及矩阵'.format(self.player_seat, self.majiang))
            print(self.StateData[self.player_seat, 0])
            line, row = self._get_array_index(majiang)
            self.StateData[self.player_seat, 0, line, row] = 0
            self.StateData[self.player_seat, 2, line, row] = 3
            # if self.player_seat != 0 or self.player_seat != 1:
            MahJong_NO_State_Base.ShowCount[line, row] += 2
            for i in range(2):
                self.majiang.remove(majiang)
            self._conv_req_mess('Pen', self._get_card_str(pen_count[0][0], pen_count[0][1]) * 3, '')
            print('玩家{}碰之后的手牌矩阵'.format(self.player_seat))
            print(self.StateData[self.player_seat, 0])
            MahJong_NO_State_Base.history.append('{},Pen,{}'.format(self.player_seat, MahJong_NO_State_Base.Now_deal))
            self.peng.append('{},Pen,{}'.format(self.player_seat, MahJong_NO_State_Base.Now_deal))
            print('碰牌后返回弃牌处理')
            return 2
        return 0

    def ai_del_chi(self, majiang):
        # can_chi, chi_count = self._check_random_chi(self.player_seat)
        # logging.debug(chi_count)
        can_chi, chi_count,chi_count_one,chi_count_two,chi_count_three = self._check_chi(self.player_seat)
        logging.debug(chi_count)
        now_line, now_row = self._get_card_index(MahJong_NO_State_Base.Now_deal)
        if can_chi:
            print(chi_count)
            print('玩家{}吃之前的手牌{}以及矩阵'.format(self.player_seat, self.majiang))
            print(self.StateData[self.player_seat, 0])
            for i in range(len(chi_count)):
                # 排除1无法吃
                if chi_count[i][1] > -1:
                    if self.StateData[self.player_seat, 0, now_line, now_row] == 0:
                        if chi_count_three != "":
                            for j in range(len(chi_count_three)):
                                action_index = self._get_card_cod(chi_count_three[j][0], chi_count_three[j][1])
                                logging.debug(action_index)
                                print("第三级吃")
                                self.chi_hou(action_index)
                                # self._conv_req_mess('Chow', index_chi[action_index], '')
                                return 1
                        if chi_count_one != "":
                            for j in range(len(chi_count_one)):
                                if len(chi_count_one) > 1:
                                    for x in range(len(chi_count_one)):
                                        # 尽量吃789 但是不能本来没有无效牌吃过后就有了
                                        if chi_count_one[x][1] == 6:
                                            action_index = self._get_card_cod(chi_count_one[x][0], chi_count_one[x][1])
                                            logging.debug(action_index)
                                            print("第一级789吃")
                                            self.chi_hou(action_index)
                                            # self._conv_req_mess('Chow', index_chi[action_index], '')
                                            return 1
                                action_index = self._get_card_cod(chi_count_one[j][0], chi_count_one[j][1])
                                logging.debug(action_index)
                                # if hand_array[line, row]==1 and
                                print("第一级吃")
                                self.chi_hou(action_index)
                                # self._conv_req_mess('Chow', index_chi[action_index], '')
                                return 1
                        if chi_count_two != "":
                            for j in range(len(chi_count_two)):
                                if len(chi_count_two) > 1:
                                    for x in range(len(chi_count_two)):
                                        # 尽量吃789 但是不能本来没有无效牌吃过后就有了
                                        if chi_count_two[x][1] == 6:
                                            action_index = self._get_card_cod(chi_count_two[x][0], chi_count_two[x][1])
                                            logging.debug(action_index)
                                            print("第二级789吃")
                                            self.chi_hou(action_index)
                                            # self._conv_req_mess('Chow', index_chi[action_index], '')
                                            return 1
                                action_index = self._get_card_cod(chi_count_two[j][0], chi_count_two[j][1])
                                logging.debug(action_index)
                                print("第二级吃")
                                self.chi_hou(action_index)
                                # self._conv_req_mess('Chow', index_chi[action_index], '')
                                return 1
                    elif self.StateData[self.player_seat, 0, now_line, now_row] == 1:
                        if chi_count_three != "":
                            for j in range(len(chi_count_three)):
                                action_index = self._get_card_cod(chi_count_three[j][0], chi_count_three[j][1])
                                logging.debug(action_index)
                                print("第三级吃")
                                self.chi_hou(action_index)
                                # self._conv_req_mess('Chow', index_chi[action_index], '')
                                return 1
                        if chi_count_two != "":
                            for j in range(len(chi_count_two)):
                                if len(chi_count_two) > 1:
                                    for x in range(len(chi_count_two)):
                                        # 尽量吃789 但是不能本来没有无效牌吃过后就有了
                                        if chi_count_two[x][1] == 6 and self.StateData[
                                            self.player_seat, 0, now_line, now_row] == 0:
                                            action_index = self._get_card_cod(chi_count_two[x][0], chi_count_two[x][1])
                                            logging.debug(action_index)
                                            print("第二级789吃")
                                            self.chi_hou(action_index)
                                            # self._conv_req_mess('Chow', index_chi[action_index], '')
                                            return 1
                                action_index = self._get_card_cod(chi_count_two[j][0], chi_count_two[j][1])
                                logging.debug(action_index)
                                print("第二级吃")
                                self.chi_hou(action_index)
                                # self._conv_req_mess('Chow', index_chi[action_index], '')
                                return 1
                        if chi_count_one != "":
                            for j in range(len(chi_count_one)):
                                if len(chi_count_one) > 1:
                                    for x in range(len(chi_count_one)):
                                        # 尽量吃789 但是不能本来没有无效牌吃过后就有了
                                        if chi_count_one[x][1] == 6:
                                            action_index = self._get_card_cod(chi_count_one[x][0], chi_count_one[x][1])
                                            logging.debug(action_index)
                                            print("第一级789吃")
                                            self.chi_hou(action_index)
                                            # self._conv_req_mess('Chow', index_chi[action_index], '')
                                            return 1
                                action_index = self._get_card_cod(chi_count_one[j][0], chi_count_one[j][1])
                                logging.debug(action_index)
                                print("第一级吃")
                                self.chi_hou(action_index)
                                # self._conv_req_mess('Chow', index_chi[action_index], '')
                                return 1
                """
                if self.StateData[self.player_seat, 0 ,chi_count[i][0], chi_count[i][1]] == 1:
                    for j in range(len(chi_count)):
                        # if len(chi_count) > 1:
                        if chi_count[j][1] > 3 and len(chi_count) > 1:
                            for x in range(len(chi_count)):
                                # 尽量吃789 但是不能本来没有无效牌吃过后就有了
                                if chi_count[x][1] == 6 and self.StateData[self.player_seat, 0, now_line, now_row]==0:
                                    action_index = self._get_card_cod(chi_count[x][0], chi_count[x][1])
                                    logging.debug(action_index)
                                    print("第一级单牌789吃并且吃的牌手牌中为0")
                                    self._conv_req_mess('Chow', index_chi[action_index], '')
                                    return
                            # 单牌能吃就不拆对子
                            if self.StateData[self.player_seat, 0, chi_count[j][0], chi_count[j][1]] == 1: # 5788chi6
                                action_index = self._get_card_cod(chi_count[j][0], chi_count[j][1])
                                logging.debug(action_index)
                                print("第一级单牌吃并且吃牌序列手牌为1")
                                self._conv_req_mess('Chow', index_chi[action_index], '')
                                return
                            action_index = self._get_card_cod(chi_count[j+1][0], chi_count[j+1][1])
                            logging.debug(action_index)
                            print("diyiji")
                            self._conv_req_mess('Chow', index_chi[action_index], '')
                            return
                        action_index = self._get_card_cod(chi_count[j][0], chi_count[j][1])
                        logging.debug(action_index)
                        print(chi_count)
                        self._conv_req_mess('Chow', index_chi[action_index], '')
                        return
                    action_index = self._get_card_cod(chi_count[i][0], chi_count[i][1])
                    logging.debug(action_index)
                    print(chi_count)
                    self._conv_req_mess('Chow', index_chi[action_index], '')
                    return
                if self.StateData[self.player_seat, 0 ,chi_count[i][0], chi_count[i][1]] == 2:
                    for j in range(len(chi_count)):
                        if len(chi_count) > 1:
                            action_index = self._get_card_cod(chi_count[j+1][0], chi_count[j+1][1])
                            logging.debug(action_index)
                            print("zhongjian")
                            self._conv_req_mess('Chow', index_chi[action_index], '')
                            return

                action_index = self._get_card_cod(chi_count[i][0], chi_count[i][1])
                logging.debug(action_index)
                print("dierji")
                self._conv_req_mess('Chow', index_chi[action_index], '')
                return
                """
            print('-'*99)
            print('玩家{}吃之后的手牌矩阵{}'.format(self.player_seat, self.StateData[self.player_seat, 0]))

        # if can_chi:
        #     print('+++++++',chi_count)
        #     print('玩家{}吃之前的手牌矩阵{}'.format(self.player_seat, self.StateData[self.player_seat, 0]))
        #     line, row = self._get_array_index(majiang)
        #     # for i in range(2):
        #     #     self.majiang.remove(majiang)
        #     # 被吃的牌
        #     now_line, now_row = self._get_card_index(MahJong_NO_State_Base.Now_deal)
        #     beichi_index = self._get_card_cod(now_line, now_row)
        #     print('被吃的牌的索引{}当前麻将的的索引{}'.format(beichi_index,majiang))
        #     action_index = self._get_card_cod(chi_count[0][0], chi_count[0][1])
        #     logging.debug(action_index)
        #     print(action_index)
        #     self.majiang.remove(action_index)
        #     self.StateData[self.player_seat, 0, chi_count[0][0], chi_count[0][1]] -= 1
        #     if action_index+1 != beichi_index:
        #         self.majiang.remove(action_index+1)
        #         line, row = self._get_array_index(action_index+1)
        #         self.StateData[self.player_seat, 0, line, row] -= 1
        #     if action_index+2 != beichi_index:
        #         self.majiang.remove(action_index+2)
        #         line, row = self._get_array_index(action_index+2)
        #         self.StateData[self.player_seat, 0, line, row] -= 1
        #     self._conv_req_mess('Chow', index_chi[action_index], '')
        #     print('玩家{}吃之后的手牌矩阵{}'.format(self.player_seat, self.StateData[self.player_seat, 0]))
        #     self.history.append('{},Chow,{}'.format(self.player_seat, index_chi[action_index]))
        #     return 1
        self._conv_req_mess('Pass', '', '')
        return 0

    def chi_hou(self, action_index):
        # print('玩家{}吃之前的手牌矩阵{}'.format(self.player_seat, self.StateData[self.player_seat, 0]))
        now_line, now_row = self._get_card_index(MahJong_NO_State_Base.Now_deal)
        beichi_index = self._get_card_cod(now_line, now_row)
        print('被吃的牌的索引{}当前吃牌的的索引{}'.format(beichi_index,action_index))
        print('action_index:',action_index)
        if action_index != beichi_index:
            self.majiang.remove(action_index)
            line, row = self._get_array_index(action_index)
            self.StateData[self.player_seat, 0, line, row] -= 1
            # if self.player_seat != 0 or self.player_seat != 1:
            MahJong_NO_State_Base.ShowCount[line, row] += 1
        if action_index+1 != beichi_index:
            self.majiang.remove(action_index+1)
            line, row = self._get_array_index(action_index+1)
            self.StateData[self.player_seat, 0, line, row] -= 1
            # if self.player_seat != 0 or self.player_seat != 1:
            MahJong_NO_State_Base.ShowCount[line, row] += 1
        if action_index+2 != beichi_index:
            self.majiang.remove(action_index+2)
            line, row = self._get_array_index(action_index+2)
            self.StateData[self.player_seat, 0, line, row] -= 1
            # if self.player_seat != 0 or self.player_seat != 1:
            MahJong_NO_State_Base.ShowCount[line, row] += 1
        self._conv_req_mess('Chow', index_chi[action_index], '')
        print('玩家{}吃之后的手牌矩阵'.format(self.player_seat))
        print(self.StateData[self.player_seat, 0])
        MahJong_NO_State_Base.history.append('{},Chow,{}'.format(self.player_seat, index_chi[action_index]))
        self.chi.append('{},Chow,{}'.format(self.player_seat, index_chi[action_index]))
        return 1

    def ai_del_logic(self):
        '''
        ai的处理逻辑
        :return:
        '''
        card_num = self.StateData[self.player_seat, 0].sum()
        # print('处理逻辑的history',self.history)
        # 天听动作
        if card_num == 13 and self.is_tting:
            is_can_tting, ting_result = self._check_ting(self.player_seat, t_ting=True)
            # 如果可以天听，并且天听的牌的种类超过两种就天听
            if is_can_tting:
                for key in ting_result.keys():
                    self._conv_req_mess('Listen', key, '')
                    print('听牌列表：',key)
                    return
            else:
                self._conv_req_mess('Pass', '', '')
        # 自己摸牌，从最后的牌开始打
        elif card_num % 3 == 2:
            global put
            put = self.del_ourself_drw()
            return put
        # 对手打牌
        elif card_num % 3 == 1:
            num = self.del_other_out(put)
            return num
        else:
            logging.error("相公")
            self._conv_req_mess('相公了', 'Self')
            return None
