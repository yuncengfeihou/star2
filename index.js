// public/extensions/third-party/favorites-plugin/index.js
import { renderExtensionTemplateAsync } from '../../../extensions.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { 
    saveSettingsDebounced, 
    systemUserName, 
    chat, 
    clearChat,
    doNewChat,
    is_send_press,
    isChatSaving,
    this_chid,
    callPopup,
    eventSource,
    event_types
} from "../../../../script.js";
import { selected_group, is_group_generating } from "../../../group-chats.js";
import { openCharacterChat } from "../../../../script.js";
import { openGroupChat } from "../../../group-chats.js";
import { renameChat } from "../../../../script.js";

// 插件名称
const PLUGIN_NAME = 'star2';

// 创建一个辅助函数来确保存在必要的数据结构
function ensureFavoritesArrayExists() {
    // 初始化插件设置
    if (!extension_settings[PLUGIN_NAME]) {
        extension_settings[PLUGIN_NAME] = {};
    }

    // 确保聊天信息存在
    if (!extension_settings[PLUGIN_NAME].chats) {
        extension_settings[PLUGIN_NAME].chats = {};
    }

    // 确保预览聊天信息存在
    if (!extension_settings[PLUGIN_NAME].previewChats) {
        extension_settings[PLUGIN_NAME].previewChats = {};
    }

    // 获取当前聊天ID
    const context = getContext();
    const chatId = context.chatId;

    // 如果当前聊天没有收藏数组，创建一个
    if (!extension_settings[PLUGIN_NAME].chats[chatId]) {
        extension_settings[PLUGIN_NAME].chats[chatId] = {
            items: [],
            nextId: 1
        };
    }

    return {
        chatSettings: extension_settings[PLUGIN_NAME].chats[chatId],
        chatId: chatId
    };
}

// 添加收藏
function addFavorite(messageInfo) {
    const { chatSettings, chatId } = ensureFavoritesArrayExists();
    
    // 检查消息是否已经收藏
    const existingFavorite = chatSettings.items.find(item => 
        item.messageId === messageInfo.messageId);
    
    if (existingFavorite) {
        console.log(`[${PLUGIN_NAME}] 消息已经收藏过了，messageId: ${messageInfo.messageId}`);
        return false;
    }
    
    // 创建新的收藏项
    const newFavorite = {
        id: chatSettings.nextId++,
        messageId: messageInfo.messageId,
        isUser: messageInfo.isUser,
        sender: messageInfo.sender,
        preview: messageInfo.preview,
        timestamp: Date.now(),
        note: ''
    };
    
    // 添加到收藏数组
    chatSettings.items.push(newFavorite);
    
    // 保存设置
    saveSettingsDebounced();
    console.log(`[${PLUGIN_NAME}] 添加了新收藏，id: ${newFavorite.id}, messageId: ${newFavorite.messageId}`);
    
    return true;
}

// 通过ID删除收藏
function removeFavoriteById(favoriteId) {
    const { chatSettings, chatId } = ensureFavoritesArrayExists();
    
    const initialLength = chatSettings.items.length;
    
    // 过滤掉要删除的收藏
    chatSettings.items = chatSettings.items.filter(item => item.id !== favoriteId);
    
    // 如果数组长度变化，说明删除成功
    const removed = chatSettings.items.length < initialLength;
    
    if (removed) {
        // 保存设置
        saveSettingsDebounced();
        console.log(`[${PLUGIN_NAME}] 删除了收藏，id: ${favoriteId}`);
        
        // 刷新图标状态
        refreshFavoriteIconsInView();
    } else {
        console.log(`[${PLUGIN_NAME}] 未能找到要删除的收藏，id: ${favoriteId}`);
    }
    
    return removed;
}

// 通过消息ID删除收藏
function removeFavoriteByMessageId(messageId) {
    const { chatSettings, chatId } = ensureFavoritesArrayExists();
    
    const favoriteToRemove = chatSettings.items.find(item => item.messageId === messageId);
    
    if (favoriteToRemove) {
        return removeFavoriteById(favoriteToRemove.id);
    } else {
        console.log(`[${PLUGIN_NAME}] 未能找到要删除的收藏，messageId: ${messageId}`);
        return false;
    }
}

// 更新收藏笔记
function updateFavoriteNote(favoriteId, note) {
    const { chatSettings, chatId } = ensureFavoritesArrayExists();
    
    const favoriteToUpdate = chatSettings.items.find(item => item.id === favoriteId);
    
    if (favoriteToUpdate) {
        favoriteToUpdate.note = note;
        saveSettingsDebounced();
        console.log(`[${PLUGIN_NAME}] 更新了收藏笔记，id: ${favoriteId}`);
        return true;
    } else {
        console.log(`[${PLUGIN_NAME}] 未能找到要更新的收藏，id: ${favoriteId}`);
        return false;
    }
}

// 处理收藏切换
function handleFavoriteToggle(event) {
    const target = $(event.currentTarget);
    const messageBlock = target.closest('.mes');
    const messageId = parseInt(messageBlock.attr('mesid'));
    
    if (isNaN(messageId)) {
        console.error(`[${PLUGIN_NAME}] 无效的mesid: ${messageBlock.attr('mesid')}`);
        return;
    }
    
    const isFavorited = target.find('i').hasClass('fa-solid');
    
    if (isFavorited) {
        // 取消收藏
        const removed = removeFavoriteByMessageId(messageId);
        if (removed) {
            target.find('i').removeClass('fa-solid').addClass('fa-regular');
        }
    } else {
        // 添加收藏
        const messageDom = messageBlock[0];
        const isUser = messageBlock.hasClass('mes_user');
        const sender = isUser ? 
            getContext().name1 : 
            $(messageDom).find('.ch_name .name').text().trim();
        
        // 获取消息预览
        const mesContent = $(messageDom).find('.mes_text').html() || '';
        // 提取文本，最多200个字符
        const textPreview = $('<div>').html(mesContent).text().substring(0, 200);
        
        const messageInfo = {
            messageId: messageId,
            isUser: isUser,
            sender: sender || (isUser ? 'User' : 'Character'),
            preview: textPreview + (textPreview.length >= 200 ? '...' : '')
        };
        
        const added = addFavorite(messageInfo);
        if (added) {
            target.find('i').removeClass('fa-regular').addClass('fa-solid');
        }
    }
}

// 为消息添加收藏图标
function addFavoriteIconsToMessages() {
    ensureFavoritesArrayExists();
    
    // 为所有没有收藏按钮的消息添加收藏按钮
    $('#chat .mes').each(function () {
        const messageBlock = $(this);
        
        // 排除系统消息和已有收藏按钮的消息
        if (messageBlock.hasClass('system') || messageBlock.find('.favorite-toggle-icon').length > 0) {
            return;
        }
        
        // 创建收藏按钮
        const favButton = $('<div class="favorite-toggle-icon" title="添加/删除收藏"><i class="fa-regular fa-star"></i></div>');
        
        // 添加到消息的extraMesButtons容器
        messageBlock.find('.extraMesButtons').append(favButton);
    });
    
    // 刷新图标状态
    refreshFavoriteIconsInView();
    
    console.log(`[${PLUGIN_NAME}] 已为消息添加收藏图标`);
}

// 刷新视图中的收藏图标
function refreshFavoriteIconsInView() {
    const { chatSettings, chatId } = ensureFavoritesArrayExists();
    
    // 遍历所有消息图标
    $('#chat .mes .favorite-toggle-icon').each(function () {
        const messageBlock = $(this).closest('.mes');
        const messageId = parseInt(messageBlock.attr('mesid'));
        
        // 检查消息是否在收藏列表中
        const isFavorited = chatSettings.items.some(item => item.messageId === messageId);
        
        // 更新图标样式
        if (isFavorited) {
            $(this).find('i').removeClass('fa-regular').addClass('fa-solid');
        } else {
            $(this).find('i').removeClass('fa-solid').addClass('fa-regular');
        }
    });
}

// 渲染收藏项
function renderFavoriteItem(favItem, index) {
    // 查看这条收藏的消息是否还存在
    let messageExists = false;
    let originalMessage = null;
    
    if (chat && chat.length > favItem.messageId) {
        originalMessage = chat[favItem.messageId];
        messageExists = !!originalMessage;
    }
    
    // 渲染收藏项目
    const itemHtml = `
        <div class="favorite-item" data-fav-id="${favItem.id}" data-index="${index}">
            <div class="fav-meta">
                ${favItem.sender || (favItem.isUser ? 'User' : 'Character')} • 
                ${new Date(favItem.timestamp).toLocaleString()} • 
                ID: ${favItem.messageId}
            </div>
            ${favItem.note ? `<div class="fav-note">${favItem.note}</div>` : ''}
            <div class="fav-preview ${!messageExists ? 'deleted' : ''}">
                ${messageExists ? favItem.preview : '(原消息已删除)'}
            </div>
            <div class="fav-actions">
                <i class="fa-solid fa-pencil" title="编辑备注"></i>
                <i class="fa-solid fa-trash" title="删除收藏"></i>
            </div>
        </div>
    `;
    
    return itemHtml;
}

// 更新收藏弹窗
function updateFavoritesPopup() {
    const { chatSettings, chatId } = ensureFavoritesArrayExists();
    
    const $popup = $('#favorites-popup');
    const $content = $popup.find('.favorites-popup-content');
    
    if (chatSettings.items.length === 0) {
        // 没有收藏时显示提示
        $content.html(`
            <div class="favorites-empty">
                <p>当前聊天没有收藏的消息</p>
                <p>点击消息右下角的星星图标来收藏重要消息</p>
            </div>
        `);
        
        // 更新标题
        $popup.find('.favorites-header h3').text('收藏列表 (0)');
        
        // 隐藏预览按钮
        $popup.find('#favorites-preview-btn').hide();
        return;
    }
    
    // 更新标题
    $popup.find('.favorites-header h3').text(`收藏列表 (${chatSettings.items.length})`);
    
    // 显示预览按钮
    $popup.find('#favorites-preview-btn').show();
    
    // 渲染所有收藏
    let favoritesHtml = '<div class="favorites-list">';
    
    // 按添加时间倒序排列
    const sortedItems = [...chatSettings.items].sort((a, b) => b.timestamp - a.timestamp);
    
    sortedItems.forEach((favItem, index) => {
        favoritesHtml += renderFavoriteItem(favItem, index);
    });
    
    favoritesHtml += '</div>';
    
    // 添加清理无效收藏按钮
    favoritesHtml += `
        <div class="favorites-footer">
            <button id="favorites-clear-invalid" class="menu_button">清理无效收藏</button>
        </div>
    `;
    
    $content.html(favoritesHtml);
    
    // 绑定事件
    $content.find('.fa-trash').off('click').on('click', function() {
        const favItem = $(this).closest('.favorite-item');
        const favId = parseInt(favItem.attr('data-fav-id'));
        const messageId = chatSettings.items.find(item => item.id === favId)?.messageId;
        
        handleDeleteFavoriteFromPopup(favId, messageId);
    });
    
    $content.find('.fa-pencil').off('click').on('click', function() {
        const favItem = $(this).closest('.favorite-item');
        const favId = parseInt(favItem.attr('data-fav-id'));
        
        handleEditNote(favId);
    });
    
    $content.find('#favorites-clear-invalid').off('click').on('click', function() {
        handleClearInvalidFavorites();
    });
}

// 显示收藏弹窗
function showFavoritesPopup() {
    // 如果弹窗已存在，更新内容
    if ($('#favorites-popup').length) {
        updateFavoritesPopup();
        return;
    }
    
    // 创建弹窗HTML
    const popupHtml = `
        <div id="favorites-popup" class="draggable">
            <div class="favorites-header">
                <h3>收藏列表</h3>
                <button id="favorites-preview-btn" class="menu_button">预览收藏</button>
                <div class="popup-closer" onclick="$('#favorites-popup').remove()">×</div>
            </div>
            <div class="favorites-divider"></div>
            <div class="favorites-popup-content">
                <div class="loader"></div>
            </div>
        </div>
    `;
    
    // 添加到页面
    $('body').append(popupHtml);
    
    // 使弹窗可拖动
    $('#favorites-popup').draggable({
        handle: '.favorites-header',
        containment: 'window'
    });
    
    // 居中显示
    const $popup = $('#favorites-popup');
    $popup.css({
        top: ($(window).height() - $popup.outerHeight()) / 2,
        left: ($(window).width() - $popup.outerWidth()) / 2
    });
    
    // 绑定预览按钮事件
    $('#favorites-preview-btn').off('click').on('click', async function() {
        await handlePreviewButtonClick();
    });
    
    // 更新内容
    updateFavoritesPopup();
}

// 从弹窗中删除收藏
async function handleDeleteFavoriteFromPopup(favId, messageId) {
    const confirmResult = await callPopup('确定要删除这条收藏吗？', 'confirm');
    
    if (!confirmResult) {
        return;
    }
    
    // 删除收藏
    const removed = removeFavoriteById(favId);
    
    if (removed) {
        // 更新弹窗内容
        updateFavoritesPopup();
    }
}

// 编辑收藏笔记
async function handleEditNote(favId) {
    const { chatSettings, chatId } = ensureFavoritesArrayExists();
    
    const favItem = chatSettings.items.find(item => item.id === favId);
    
    if (!favItem) {
        console.error(`[${PLUGIN_NAME}] 未能找到收藏项，id: ${favId}`);
        return;
    }
    
    const result = await callPopup('<textarea id="favorite-note-input" style="width:100%; height:100px;">'+ (favItem.note || '') +'</textarea>', 'input');
    
    if (result) {
        updateFavoriteNote(favId, result);
        updateFavoritesPopup();
    }
}

// 清除无效收藏
async function handleClearInvalidFavorites() {
    if (!chat || chat.length === 0) {
        toastr.warning('聊天记录为空，无法检查收藏有效性');
        return;
    }
    
    const { chatSettings, chatId } = ensureFavoritesArrayExists();
    
    // 找出引用不存在的消息的收藏项
    const invalidItems = chatSettings.items.filter(item => {
        return item.messageId >= chat.length || !chat[item.messageId];
    });
    
    if (invalidItems.length === 0) {
        toastr.success('没有发现无效收藏');
        return;
    }
    
    const confirmResult = await callPopup(`发现 ${invalidItems.length} 条无效收藏，确定要清除吗？`, 'confirm');
    
    if (!confirmResult) {
        return;
    }
    
    // 删除无效收藏
    invalidItems.forEach(item => {
        removeFavoriteById(item.id);
    });
    
    // 更新弹窗
    updateFavoritesPopup();
    
    toastr.success(`已清除 ${invalidItems.length} 条无效收藏`);
}

// --- 预览功能 ---

// 确保预览聊天的数据存在
function ensurePreviewData() {
    // 获取当前聊天和角色/群组信息
    const context = getContext();
    const chatId = context.chatId;
    const characterId = context.characterId;
    const groupId = context.groupId;
    
    // 确保预览聊天ID存储位置存在
    if (!extension_settings[PLUGIN_NAME].previewChats) {
        extension_settings[PLUGIN_NAME].previewChats = {};
    }
    
    return {
        chatId,
        characterId,
        groupId
    };
}

// 处理预览按钮点击
async function handlePreviewButtonClick() {
    console.log(`[${PLUGIN_NAME}] 预览按钮被点击`);
    
    try {
        // 检查是否有角色或群组被选中
        if (selected_group === null && this_chid === undefined) {
            console.error(`[${PLUGIN_NAME}] 错误: 没有选择角色或群组`);
            toastr.error('请先选择一个角色或群组');
            return;
        }

        // 检查是否正在生成或保存，避免冲突
        if (is_send_press || is_group_generating) {
            console.error(`[${PLUGIN_NAME}] 错误: 正在生成回复，无法创建预览聊天`);
            toastr.warning('正在生成回复，请稍后再试');
            return;
        }
        if (isChatSaving) {
            console.error(`[${PLUGIN_NAME}] 错误: 聊天正在保存，无法创建预览聊天`);
            toastr.warning('聊天正在保存，请稍后再试');
            return;
        }
        
        // 获取当前上下文和收藏数据
        const context = getContext();
        const { chatId, characterId, groupId } = ensurePreviewData();
        
        // 获取收藏项列表
        const { chatSettings } = ensureFavoritesArrayExists();
        const favoriteItems = chatSettings.items;
        
        if (favoriteItems.length === 0) {
            toastr.warning('没有收藏的消息可以预览');
            return;
        }
        
        console.log(`[${PLUGIN_NAME}] 当前聊天收藏消息数量: ${favoriteItems.length}`);
        
        // 获取原始聊天消息
        const originalChat = [...chat];
        console.log(`[${PLUGIN_NAME}] 原始聊天总消息数: ${originalChat.length}`);
        
        // 检查是否已经有预览聊天ID
        const previewKey = groupId ? `group_${groupId}` : `char_${characterId}`;
        const existingPreviewChatId = extension_settings[PLUGIN_NAME].previewChats[previewKey];
        
        let isFirstPreview = false;
        
        if (existingPreviewChatId) {
            console.log(`[${PLUGIN_NAME}] 发现现有预览聊天ID: ${existingPreviewChatId}`);
            
            // 切换到现有预览聊天
            if (groupId) {
                console.log(`[${PLUGIN_NAME}] 正在切换到群组预览聊天...`);
                await openGroupChat(groupId, existingPreviewChatId);
            } else {
                console.log(`[${PLUGIN_NAME}] 正在切换到角色预览聊天...`);
                await openCharacterChat(characterId, existingPreviewChatId);
            }
        } else {
            console.log(`[${PLUGIN_NAME}] 未找到预览聊天ID，将创建新聊天`);
            isFirstPreview = true;
            
            // 创建新聊天并切换
            await doNewChat({ deleteCurrentChat: false });
            
            // 获取新创建的聊天ID
            const newContext = getContext();
            const newPreviewChatId = newContext.chatId;
            
            if (!newPreviewChatId) {
                console.error(`[${PLUGIN_NAME}] 创建新聊天后无法获取聊天ID`);
                toastr.error('创建预览聊天失败');
                return;
            }
            
            console.log(`[${PLUGIN_NAME}] 新聊天ID: ${newPreviewChatId}`);
            
            // 将新聊天ID保存为预览聊天
            extension_settings[PLUGIN_NAME].previewChats[previewKey] = newPreviewChatId;
            saveSettingsDebounced();
            
            // 首次预览不立即重命名，等填充消息后再重命名
            console.log(`[${PLUGIN_NAME}] 首次预览，将在填充消息后重命名聊天`);
        }
        
        // 延迟一下确保聊天加载完成
        const loadDelay = isFirstPreview ? 2000 : 1000;
        console.log(`[${PLUGIN_NAME}] 等待 ${loadDelay}ms 确保聊天加载完成...`);
        await new Promise(resolve => setTimeout(resolve, loadDelay));
        
        // 清空当前聊天
        console.log(`[${PLUGIN_NAME}] 清空当前聊天...`);
        clearChat();
        
        // 再次延迟，确保清空操作完成
        console.log(`[${PLUGIN_NAME}] 等待300ms确保清空操作完成...`);
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // 准备要填充的收藏消息
        console.log(`[${PLUGIN_NAME}] 正在准备收藏消息以填充预览聊天...`);
        const messagesToFill = [];
        
        // 遍历收藏项，收集对应的完整消息
        for (const favItem of favoriteItems) {
            const messageId = favItem.messageId;
            
            if (messageId < originalChat.length && originalChat[messageId]) {
                // 创建消息的深拷贝，避免引用原始对象
                const messageCopy = JSON.parse(JSON.stringify(originalChat[messageId]));
                
                // 记录原始的mesid
                messageCopy.original_mesid = messageId;
                
                messagesToFill.push({
                    message: messageCopy,
                    mesid: messageId
                });
                
                console.log(`[${PLUGIN_NAME}] 已找到收藏消息 ID ${messageId}: ${originalChat[messageId].mes.substring(0, 30)}...`);
            } else {
                console.warn(`[${PLUGIN_NAME}] 警告: 收藏消息 ID ${messageId} 不存在或已删除`);
            }
        }
        
        // 将messagesToFill按照mesid从小到大排序，确保消息按正确顺序添加
        messagesToFill.sort((a, b) => a.mesid - b.mesid);
        
        console.log(`[${PLUGIN_NAME}] 找到 ${messagesToFill.length} 条有效收藏消息可以填充`);
        
        // 获取当前上下文
        const newContext = getContext();
        console.log(`[${PLUGIN_NAME}] 获取新的上下文完成，准备填充消息`);
        
        // 填充消息到聊天
        let addedCount = 0;
        let hasRenamed = !isFirstPreview; // 如果不是首次预览，就不需要重命名
        
        for (const item of messagesToFill) {
            try {
                const message = item.message;
                const mesid = item.mesid;
                
                console.log(`[${PLUGIN_NAME}] 正在添加消息 mesid=${mesid}: ${message.mes.substring(0, 30)}...`);
                
                // 使用forceId设置为原始的mesid
                await newContext.addOneMessage(message, { 
                    scroll: true,
                    forceId: mesid
                });
                
                // 首条消息添加成功后进行重命名（仅首次预览需要）
                if (addedCount === 0 && isFirstPreview && !hasRenamed) {
                    try {
                        // 等待一段时间后再尝试重命名
                        await new Promise(resolve => setTimeout(resolve, 1000));
                        console.log(`[${PLUGIN_NAME}] 尝试重命名聊天为<预览聊天>...`);
                        await renameChat("<预览聊天>");
                        hasRenamed = true;
                        console.log(`[${PLUGIN_NAME}] 聊天已重命名为<预览聊天>`);
                    } catch (renameError) {
                        console.warn(`[${PLUGIN_NAME}] 重命名聊天失败，将继续填充消息:`, renameError);
                        // 即使重命名失败也继续填充
                    }
                }
                
                // 在消息之间添加短暂延迟，确保顺序正确
                await new Promise(resolve => setTimeout(resolve, 100));
                
                console.log(`[${PLUGIN_NAME}] 消息 mesid=${mesid} 添加成功`);
                addedCount++;
                
            } catch (error) {
                console.error(`[${PLUGIN_NAME}] 添加消息时出错:`, error);
                // 发生错误时暂停一下再继续
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }
        
        // 显示成功消息
        toastr.success(`已在预览聊天中显示 ${addedCount} 条收藏消息`);
        
    } catch (error) {
        console.error(`[${PLUGIN_NAME}] 执行预览过程中发生错误:`, error);
        toastr.error('创建预览聊天或填充消息时出错，请查看控制台');
    }
}

// --- 初始化 ---

jQuery(async () => {
    console.log(`[${PLUGIN_NAME}] 插件正在初始化...`);
    
    try {
        // 注入CSS样式
        const styleElement = document.createElement('style');
        styleElement.innerHTML = `
            /* Favorites popup styles */
            .favorites-popup-content {
                padding: 10px;
                max-height: 70vh;
                overflow-y: auto;
            }

            .favorites-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 0 10px;
            }

            .favorites-header h3 {
                text-align: center;
                margin: 0;
            }

            .favorites-divider {
                height: 1px;
                background-color: #ff3a3a;
                margin: 10px 0;
            }

            .favorites-list {
                margin: 10px 0;
            }

            .favorites-empty {
                text-align: center;
                color: #888;
                padding: 20px;
            }

            .favorite-item {
                border: 1px solid #444;
                border-radius: 8px;
                margin-bottom: 10px;
                padding: 10px;
                background-color: rgba(0, 0, 0, 0.2);
                position: relative;
            }

            .fav-meta {
                font-size: 0.8em;
                color: #aaa;
                margin-bottom: 5px;
            }

            .fav-note {
                background-color: rgba(255, 255, 0, 0.1);
                padding: 5px;
                border-left: 3px solid #ffcc00;
                margin-bottom: 5px;
                font-style: italic;
            }

            .fav-preview {
                margin-bottom: 5px;
                line-height: 1.4;
                max-height: 200px;
                overflow-y: auto;
                word-wrap: break-word;
                white-space: pre-wrap;
            }

            .fav-preview.deleted {
                color: #ff3a3a;
                font-style: italic;
                max-height: 200px;
                overflow-y: auto;
                word-wrap: break-word;
                white-space: pre-wrap;
            }

            .fav-actions {
                text-align: right;
            }

            .fav-actions i {
                cursor: pointer;
                margin-left: 10px;
                padding: 5px;
                border-radius: 50%;
            }

            .fav-actions i:hover {
                background-color: rgba(255, 255, 255, 0.1);
            }

            .fa-pencil {
                color: #3a87ff;
            }

            .fa-trash {
                color: #ff3a3a;
            }

            /* Star icon styles */
            .favorite-toggle-icon {
                cursor: pointer;
            }

            .favorite-toggle-icon i.fa-regular {
                color: #999;
            }

            .favorite-toggle-icon i.fa-solid {
                color: #ffcc00;
            }
        `;
        document.head.appendChild(styleElement);
        
        // 注入插件界面到扩展设置页面
        const settingsHtml = await renderExtensionTemplateAsync(`third-party/${PLUGIN_NAME}`, 'settings_display');
        $('#extensions_settings').append(settingsHtml);
        console.log(`[${PLUGIN_NAME}] 已添加设置界面到扩展页面`);
        
        // 添加收藏按钮到输入框右侧
        const inputButtonHtml = await renderExtensionTemplateAsync(`third-party/${PLUGIN_NAME}`, 'input_button');
        $('#data_bank_wand_container').append(inputButtonHtml);
        console.log(`[${PLUGIN_NAME}] 已添加按钮到输入框右侧`);
        
        // 绑定收藏按钮点击事件
        $('#favorites_button').on('click', function() {
            showFavoritesPopup();
        });
        
        // 使用事件委托绑定消息上收藏图标点击事件
        $(document).on('click', '.favorite-toggle-icon', handleFavoriteToggle);
        
        // 监听聊天改变事件，刷新图标
        eventSource.on(event_types.CHAT_CHANGED, () => {
            console.log(`[${PLUGIN_NAME}] 聊天已改变，添加收藏图标`);
            addFavoriteIconsToMessages();
        });
        
        // 监听新消息到达事件
        const handleNewMessage = () => {
            console.log(`[${PLUGIN_NAME}] 检测到新消息，添加收藏图标`);
            addFavoriteIconsToMessages();
        };
        
        // 监听"显示更多消息"事件
        eventSource.on(event_types.MORE_MESSAGES_LOADED, () => {
            console.log(`[${PLUGIN_NAME}] 加载了更多消息，添加收藏图标`);
            addFavoriteIconsToMessages();
        });
        
        eventSource.on(event_types.MESSAGE_RECEIVED, handleNewMessage);
        eventSource.on(event_types.MESSAGE_SENT, handleNewMessage);
        eventSource.on(event_types.MESSAGE_EDITED, handleNewMessage);
        
        // 初始化收藏图标
        setTimeout(() => {
            addFavoriteIconsToMessages();
        }, 1000);
        
        console.log(`[${PLUGIN_NAME}] 插件初始化完成!`);
    } catch (error) {
        console.error(`[${PLUGIN_NAME}] 初始化时出错:`, error);
    }
});
