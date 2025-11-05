<script setup>
import { log } from '@/composables/useUtils';
import { useManagers } from '@/composables/useManagersProvider.js';
import { useUIStore, useAvatarStore } from '@/stores';

defineOptions({
  name: 'StaffAvatar',
});

const props = defineProps({
  avatars: {
    type: Object,
    default: () => ({}),
  },
  avatar: {
    type: String,
    default: 'human1',
  },
  initAction: {
    type: String,
    default: 'static',
  },
});

const emit = defineEmits(['speak-text']);

const { ui, avatarState, audio, utils } = useManagers();

// 使用 Pinia stores
const uiStore = useUIStore();

const currentAction = computed(() => {
  const val = uiStore.currentAction || 'dance'
  const result = typeof val === 'string' ? val : 'dance'
  return result
});
// 当前形象动作集合
const actions = computed(() => {
  const list = props.avatars[props.avatar]?.actions;
  return list || {};
});

// 当前形象当前激活动作配置数据
const actionConfig = computed(() => {
  const actionKey = currentAction.value;
  const cfg = actions.value[actionKey];
  if (!cfg) {
    return {};
  }
  return cfg;
});

// 交叉淡入：稳定容器，仅切换内部图层，避免闪烁
const currentBgUrl = ref('')
const prevBgUrl = ref('')
const isFading = ref(false)
const isFadingVisible = ref(false)
let switchCounter = 0

const fallbackApng = computed(() => {
  return props.avatars?.[props.avatar]?.actions?.static?.apng || ''
})

// 监听当前动作图片变化并预加载新图，完成后交叉淡入
watch(
  () => actionConfig.value?.apng,
  (newUrl) => {
    const targetUrl = newUrl || fallbackApng.value
    if (!targetUrl) return
    // 首次设置：不做淡入
    if (!currentBgUrl.value) {
      currentBgUrl.value = targetUrl
      prevBgUrl.value = ''
      isFading.value = false
      isFadingVisible.value = false
      return
    }
    if (targetUrl === currentBgUrl.value) return

    const currentSwitch = ++switchCounter
    const img = new Image()
    img.onload = async () => {
      // 仅应用最近一次切换
      if (currentSwitch !== switchCounter) return
      prevBgUrl.value = currentBgUrl.value
      currentBgUrl.value = targetUrl
      isFading.value = true
      isFadingVisible.value = false
      await nextTick()
      // 触发淡入
      requestAnimationFrame(() => {
        isFadingVisible.value = true
      })
      // 等待CSS过渡完成后再清理旧层
      setTimeout(() => {
        if (currentSwitch !== switchCounter) return
        prevBgUrl.value = ''
        isFading.value = false
        isFadingVisible.value = false
      }, 120)
    }
    img.onerror = () => {
      // 加载失败则保持现状，避免空白
      console.warn('动作图片加载失败:', targetUrl)
    }
    img.src = targetUrl
  },
  { immediate: true }
)

// 行为分类及筛选出可见行为
const categories = {
  常规动作: ['action', 'sayHi', 'welcome', 'speak', 'listen', 'dance'],
  情绪: ['finishing', 'heart', 'happy', 'disappointed'],
  业务动作: ['submitInvoice', 'queryData', 'introduceProd', 'tel', 'telConfirm'],
};
const actionsVisbled = computed(() => {
  return Object.entries(categories).map(([cat, acts]) => {
    return {
      classify: cat,
      list: acts
        .filter(k => actions.value[k]?.actionShow)
        .map(item => ({
          id: item,
          ...actions.value[item],
        })),
    };
  });
});

const imgs = {
  finishing: 'sh.gif',
  heart: 'heart.gif',
  happy: 'happy.gif',
  disappointed: 'disappointed.gif',
  submitInvoice: 'submitInvoice.gif',
  queryData: 'queryData.gif',
  introduceProd: 'introduceProd.png',
};

const textMap = {
  action: '嗨，你可以通过语音切换我的动作',
  sayHi: '嗨~你好',
  welcome: '你好~ 欢迎来到朝阳门营业厅',
  speak: '中国电信集团有限公司是中国特大型通信运营企业',
  listen: '小翼没有听清',
  dance: '',
  finishing: '成功了！',
  heart: '比心',
  happy: '',
  disappointed: '哎',
  submitInvoice: '发票已开具，请查收',
  queryData: '正在查询，请稍等',
  introduceProd: '天翼数字生活公司重磅发布新一代AI中台开启美好数字生活新纪元',
  tel: '18922565478',
  telConfirm: '好的，充值号码是18952254781，机主姓名是刘*闲，充值50元，请您确认',
};

// 切换动作
const switchAction = (key) => {
  log('切换动作', key);
  uiStore.setCurrentAction(key);

  // 使用新的Composables替代全局管理器
  audio.stopCurrentAudio();
  setTimeout(() => {
    const text = textMap[key];
    audio.playCustomAudio(text);
    // 使用打字机效果通过 store 渲染，并逐步上报字幕
    utils.typeWriterToStore?.(text || '', {
      callback(typeText) {
        emit('speak-text', typeText)
      }
    })
    if (key === 'tel') utils.typeWriterToStore(text);
    if (key === 'telConfirm') utils.typeWriterToStore('18952254781');
  }, 300);
}
</script>

<template>
  <div class="page_main">
    <div class="page_human">
      <div :class="['page_human_ani', 'human', avatar]" id="voiceAvatar">
        <!-- 旧层：在新图淡入完成前始终可见 -->
        <div v-if="prevBgUrl" class="bg-layer prev"
          :style="{ background: `url(${prevBgUrl}) center center/100% auto no-repeat` }"></div>
        <!-- 新层：先透明插入，然后淡入到可见 -->
        <div v-if="currentBgUrl" class="bg-layer current"
          :style="{
            background: `url(${currentBgUrl}) center center/100% auto no-repeat`,
            opacity: isFading ? (isFadingVisible ? 1 : 0) : 1
          }"></div>
      </div>
    </div>
    <div class="page_human_contorl">
      <div v-show="ui.actionStatus.value" class="actionStatus">
        <div class="action_list">
          <template v-for="(item, index) in actionsVisbled" :key="index">
            <dt v-if="item.list.length">{{ item.classify }}</dt>
            <dd v-for="act in item.list" :key="act.id" :class="{ active: act.id === currentAction }" :data-ani="act.id"
              @click="switchAction(act.id)">
              {{ act.name }}
              <img v-if="imgs[act.id]" :class="[act.id]" :src="`pub-ui/images/action/${imgs[act.id]}`" alt="icon" />
              <p v-if="['tel', 'telConfirm'].includes(act.id)" class="telNum"
                :id="act.id === 'tel' ? 'telNum' : 'telNum2'"></p>
            </dd>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss">
.actionStatus {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 100;

  &_ani {
    background: center center/100% auto no-repeat;
  }

  &.show {
    display: inline-block;
    animation: rightAni 0.5s ease-in-out forwards;
  }
}

@keyframes rightAni {
    0% {
        transform: translateX(100%);
    }

    100% {
        transform: translateX(0);
    }
}

/* 交叉淡入图层，避免因容器或过渡引起的空白闪烁 */
.page_human_ani { position: relative; }
.bg-layer {
  position: absolute;
  left: 0;
  top: 0;
  width: 100%;
  height: 100%;
  background-repeat: no-repeat;
  background-position: center center;
  background-size: 100% auto;
  will-change: opacity, background-image;
  transition: opacity 0.1s ease-in-out;
}
.bg-layer.prev { opacity: 1; }
.bg-layer.current { opacity: 1; }
</style>
