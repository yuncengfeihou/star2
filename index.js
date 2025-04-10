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
    this_chid
} from "../../../../script.js";
import { callPopup } from "../../../popup.js";
import { selected_group, is_group_generating } from "../../../group-chats.js";
import { openCharacterChat } from "../../../../script.js";
import { openGroupChat } from "../../../group-chats.js";
import { renameChat } from "../../../../script.js";

// 插件名称
const PLUGIN_NAME = 'favorites-plugin';

/**
 * 初始化插件的必要数据结构
 */
function ensureFavoritesArrayExists() {
    // 确保插件设置存在
    if (!extension_settings[PLUGIN_NAME]) {
        extension_settings[PLUGIN_NAME] = {};
    }

    // 确保chats对象存在
    if (!extension_settings[PLUGIN_NAME].chats) {
        extension_settings[PLUGIN_NAME].chats = {};
    }

    // 确保当前聊天的收藏数据存在
    const context = getContext();
    const chatId = context.chatId;

    if (!chatId) {
        console.debug(`${PLUGIN_NAME}: No active chat id found`);
        return false;
    }

    if (!extension_settings[PLUGIN_NAME].chats[chatId]) {
        extension_settings[PLUGIN_NAME].chats[chatId] = {
            items: [],
            nextId: 1,
            previewChatId: null // 添加存储预览聊天ID的字段
        };
        console.debug(`${PLUGIN_NAME}: Created favorites array for chat ${chatId}`);
        saveSettingsDebounced();
    }

    return true;
}

/**
 * 添加新收藏
 * @param {Object} messageInfo 消息信息
 * @returns {Object|false} 新添加的收藏对象或失败标志
 */
function addFavorite(messageInfo) {
    if (!ensureFavoritesArrayExists()) {
        return false;
    }

    const context = getContext();
    const chatId = context.chatId;
    const favorites = extension_settings[PLUGIN_NAME].chats[chatId];

    // 检查是否已收藏
    const existingFavorite = favorites.items.find(item => 
        String(item.messageId) === String(messageInfo.id));
    
    if (existingFavorite) {
        console.debug(`${PLUGIN_NAME}: Message already favorited`, messageInfo.id);
        return false;
    }

    // 创建新收藏
    const newFavorite = {
        id: favorites.nextId++,
        messageId: messageInfo.id,
        name: messageInfo.name,
        isUser: messageInfo.is_user || false,
        isSystem: messageInfo.is_system || false,
        avatar: messageInfo.force_avatar || messageInfo.avatar,
        messageText: messageInfo.mes.substring(0, 100) + (messageInfo.mes.length > 100 ? '...' : ''),
        timestamp: Date.now(),
        note: ''
    };

    favorites.items.push(newFavorite);
    saveSettingsDebounced();
    
    console.debug(`${PLUGIN_NAME}: Added favorite`, newFavorite);
    return newFavorite;
}

/**
 * 根据收藏ID删除收藏
 * @param {number} favoriteId 收藏ID
 * @returns {boolean} 是否成功删除
 */
function removeFavoriteById(favoriteId) {
    if (!ensureFavoritesArrayExists()) {
        return false;
    }

    const context = getContext();
    const chatId = context.chatId;
    const favorites = extension_settings[PLUGIN_NAME].chats[chatId];

    // 查找收藏索引
    const index = favorites.items.findIndex(item => item.id === favoriteId);
    
    if (index === -1) {
        console.debug(`${PLUGIN_NAME}: Favorite not found`, favoriteId);
        return false;
    }

    // 移除收藏
    favorites.items.splice(index, 1);
    saveSettingsDebounced();
    
    console.debug(`${PLUGIN_NAME}: Removed favorite`, favoriteId);
    return true;
}

/**
 * 根据消息ID删除收藏
 * @param {number|string} messageId 消息ID
 * @returns {boolean} 是否成功删除
 */
function removeFavoriteByMessageId(messageId) {
    if (!ensureFavoritesArrayExists()) {
        return false;
    }

    const context = getContext();
    const chatId = context.chatId;
    const favorites = extension_settings[PLUGIN_NAME].chats[chatId];

    // 查找收藏索引
    const index = favorites.items.findIndex(item => String(item.messageId) === String(messageId));
    
    if (index === -1) {
        console.debug(`${PLUGIN_NAME}: Favorite with message ID not found`, messageId);
        return false;
    }

    // 移除收藏
    favorites.items.splice(index, 1);
    saveSettingsDebounced();
    
    console.debug(`${PLUGIN_NAME}: Removed favorite with message ID`, messageId);
    return true;
}

/**
 * 更新收藏的备注
 * @param {number} favoriteId 收藏ID
 * @param {string} note 新备注
 * @returns {boolean} 是否成功更新
 */
function updateFavoriteNote(favoriteId, note) {
    if (!ensureFavoritesArrayExists()) {
        return false;
    }

    const context = getContext();
    const chatId = context.chatId;
    const favorites = extension_settings[PLUGIN_NAME].chats[chatId];

    // 查找收藏
    const favorite = favorites.items.find(item => item.id === favoriteId);
    
    if (!favorite) {
        console.debug(`${PLUGIN_NAME}: Favorite not found for note update`, favoriteId);
        return false;
    }

    // 更新备注
    favorite.note = note;
    saveSettingsDebounced();
    
    console.debug(`${PLUGIN_NAME}: Updated note for favorite`, favoriteId);
    return true;
}

/**
 * 处理收藏/取消收藏按钮点击
 * @param {Event} event 点击事件
 */
function handleFavoriteToggle(event) {
    const messageBlock = $(event.currentTarget).closest('.mes');
    const messageId = Number(messageBlock.attr('mesid'));
    
    if (isNaN(messageId)) {
        console.error(`${PLUGIN_NAME}: Invalid message ID`, messageId);
        return;
    }

    // 检查是否已经收藏
    const context = getContext();
    const chatId = context.chatId;
    
    if (!extension_settings[PLUGIN_NAME].chats?.[chatId]) {
        ensureFavoritesArrayExists();
    }

    const favorites = extension_settings[PLUGIN_NAME].chats[chatId];
    const existingFavoriteIndex = favorites.items.findIndex(item => 
        String(item.messageId) === String(messageId));
    
    if (existingFavoriteIndex !== -1) {
        // 已收藏，移除收藏
        removeFavoriteById(favorites.items[existingFavoriteIndex].id);
        $(event.currentTarget).removeClass('active');
        toastr.success('已移除收藏');
    } else {
        // 未收藏，添加收藏
        if (messageId < 0 || messageId >= chat.length) {
            console.error(`${PLUGIN_NAME}: Message ID out of range`, messageId, chat.length);
            toastr.error('无法收藏：消息不存在');
            return;
        }

        const message = chat[messageId];
        if (!message) {
            console.error(`${PLUGIN_NAME}: Message not found at index`, messageId);
            toastr.error('无法收藏：消息不存在');
            return;
        }

        // 创建收藏信息
        const messageInfo = {
            id: messageId, // 使用mesid作为id
            name: message.name,
            is_user: message.is_user,
            is_system: message.is_system,
            force_avatar: message.force_avatar,
            avatar: message.avatar,
            mes: message.mes
        };

        if (addFavorite(messageInfo)) {
            $(event.currentTarget).addClass('active');
            toastr.success('已添加收藏');
        } else {
            toastr.error('添加收藏失败');
        }
    }

    // 刷新收藏图标样式
    refreshFavoriteIconsInView();
}

/**
 * 为所有消息添加收藏图标
 */
function addFavoriteIconsToMessages() {
    // 为所有消息添加收藏按钮
    $('.mes:not(.system):not(.has-favorite-icon)').each(function() {
        $(this).addClass('has-favorite-icon');
        const extraButtonsDiv = $(this).find('.extraMesButtons');
        if (extraButtonsDiv.length) {
            extraButtonsDiv.append(`
                <div class="mes_button favorite-toggle" title="收藏此消息">
                    <i class="fa-solid fa-star"></i>
                </div>
            `);
        }
    });
}

/**
 * 刷新可见消息的收藏图标状态
 */
function refreshFavoriteIconsInView() {
    if (!ensureFavoritesArrayExists()) {
        return;
    }

    const context = getContext();
    const chatId = context.chatId;
    const favorites = extension_settings[PLUGIN_NAME].chats[chatId];

    // 清除所有活跃状态
    $('.favorite-toggle').removeClass('active');

    // 设置已收藏消息的活跃状态
    favorites.items.forEach(favorite => {
        const messageId = favorite.messageId;
        const messageBlock = $(`.mes[mesid="${messageId}"]`);
        if (messageBlock.length) {
            messageBlock.find('.favorite-toggle').addClass('active');
        }
    });
}

/**
 * 渲染单个收藏项
 * @param {Object} favItem 收藏项
 * @param {number} index 索引
 * @returns {string} HTML字符串
 */
function renderFavoriteItem(favItem, index) {
    const avatarImg = favItem.avatar 
        ? `<img src="${favItem.avatar}" class="avatar" />`
        : `<div class="avatar default"></div>`;

    const nameClass = favItem.isUser ? 'user-name' : (favItem.isSystem ? 'system-name' : 'char-name');
    const noteText = favItem.note ? `<div class="favorite-note"><strong>备注:</strong> ${favItem.note}</div>` : '';
    
    return `
        <div class="favorite-item" data-id="${favItem.id}" data-message-id="${favItem.messageId}" data-index="${index}">
            <div class="favorite-header">
                <div class="favorite-avatar">${avatarImg}</div>
                <div class="favorite-name ${nameClass}">${favItem.name}</div>
                <div class="favorite-actions">
                    <button class="btn_edit_note" title="编辑备注"><i class="fa-solid fa-pencil"></i></button>
                    <button class="btn_delete_favorite" title="删除收藏"><i class="fa-solid fa-trash"></i></button>
                </div>
            </div>
            <div class="favorite-content">${favItem.messageText}</div>
            ${noteText}
        </div>
    `;
}

/**
 * 更新收藏弹窗内容
 */
function updateFavoritesPopup() {
    if (!ensureFavoritesArrayExists()) {
        return;
    }

    const context = getContext();
    const chatId = context.chatId;
    const favorites = extension_settings[PLUGIN_NAME].chats[chatId];

    // 获取容器元素
    const container = $('#favorites_popup_content');
    if (!container.length) return;

    // 清空容器
    container.empty();

    // 添加标题和操作栏
    container.append(`
        <div class="favorites-header">
            <h3>收藏消息</h3>
            <div class="favorites-actions">
                <button id="preview_favorites_button" class="menu_button" title="预览收藏的消息">
                    <i class="fa-solid fa-eye"></i> 预览
                </button>
                <button id="clear_invalid_favorites_button" class="menu_button" title="清理无效收藏">
                    <i class="fa-solid fa-broom"></i> 清理
                </button>
                <button id="close_favorites_popup_button" class="menu_button" title="关闭">
                    <i class="fa-solid fa-xmark"></i>
                </button>
            </div>
        </div>
    `);

    // 添加收藏内容
    const favoritesList = $('<div class="favorites-list"></div>');
    container.append(favoritesList);

    if (favorites.items.length === 0) {
        favoritesList.append('<div class="no-favorites">没有收藏的消息</div>');
    } else {
        // 按时间倒序排列
        const sortedFavorites = [...favorites.items].sort((a, b) => b.timestamp - a.timestamp);
        
        sortedFavorites.forEach((favItem, index) => {
            favoritesList.append(renderFavoriteItem(favItem, index));
        });
    }

    // 添加事件监听
    $('#close_favorites_popup_button').off('click').on('click', function() {
        $('#favorites_popup').hide();
    });

    $('#clear_invalid_favorites_button').off('click').on('click', async function() {
        await handleClearInvalidFavorites();
        updateFavoritesPopup();
    });

    $('#preview_favorites_button').off('click').on('click', async function() {
        await handlePreviewFavorites();
    });

    $('.btn_delete_favorite').off('click').on('click', async function() {
        const favoriteItem = $(this).closest('.favorite-item');
        const favoriteId = Number(favoriteItem.data('id'));
        const messageId = favoriteItem.data('message-id');
        
        await handleDeleteFavoriteFromPopup(favoriteId, messageId);
        updateFavoritesPopup();
    });

    $('.btn_edit_note').off('click').on('click', async function() {
        const favoriteId = Number($(this).closest('.favorite-item').data('id'));
        await handleEditNote(favoriteId);
        updateFavoritesPopup();
    });

    // 弹窗样式
    $('#favorites_popup').css({
        display: 'flex',
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '70%',
        maxWidth: '800px',
        height: '80%',
        maxHeight: '600px',
        backgroundColor: 'var(--SmartThemeShadowColor)',
        zIndex: 1001,
        border: '1px solid var(--SmartThemeBorderColor)',
        borderRadius: '10px',
        flexDirection: 'column',
        padding: '10px'
    });

    $('#favorites_popup_content').css({
        overflow: 'auto',
        flex: 1,
        display: 'flex',
        flexDirection: 'column'
    });

    $('.favorites-header').css({
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '15px',
        padding: '5px',
        borderBottom: '1px solid var(--SmartThemeBorderColor)'
    });

    $('.favorites-actions').css({
        display: 'flex',
        gap: '5px'
    });

    $('.favorites-list').css({
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        overflow: 'auto',
        flex: 1
    });

    $('.favorite-item').css({
        backgroundColor: 'var(--SmartThemeBlurTintColor)',
        border: '1px solid var(--SmartThemeBorderColor)',
        borderRadius: '5px',
        padding: '10px',
        display: 'flex',
        flexDirection: 'column',
        gap: '5px'
    });

    $('.favorite-header').css({
        display: 'flex',
        alignItems: 'center',
        gap: '10px'
    });

    $('.favorite-avatar').css({
        width: '36px',
        height: '36px',
        borderRadius: '50%',
        overflow: 'hidden'
    });

    $('.favorite-avatar img').css({
        width: '100%',
        height: '100%',
        objectFit: 'cover'
    });

    $('.favorite-name').css({
        flex: 1,
        fontWeight: 'bold'
    });

    $('.favorite-actions').css({
        display: 'flex',
        gap: '5px'
    });

    $('.favorite-content').css({
        padding: '5px',
        backgroundColor: 'rgba(0,0,0,0.1)',
        borderRadius: '5px'
    });

    $('.favorite-note').css({
        fontStyle: 'italic',
        padding: '5px',
        backgroundColor: 'rgba(255,255,0,0.1)',
        borderRadius: '5px'
    });

    $('.user-name').css({
        color: 'var(--SmartThemeUserMesColor)'
    });

    $('.char-name').css({
        color: 'var(--SmartThemeCharMesColor)'
    });

    $('.system-name').css({
        color: 'var(--SmartThemeSystemMesColor)'
    });
}

/**
 * 显示收藏弹窗
 */
function showFavoritesPopup() {
    // 确保弹窗容器存在
    if (!$('#favorites_popup').length) {
        $('body').append('<div id="favorites_popup"><div id="favorites_popup_content"></div></div>');
    }

    // 更新弹窗内容
    updateFavoritesPopup();

    // 显示弹窗
    $('#favorites_popup').show();

    // 点击弹窗外部关闭
    $(document).on('mousedown.favorites_popup', function(e) {
        const $target = $(e.target);
        if ($('#favorites_popup').is(':visible') && 
            !$target.closest('#favorites_popup').length &&
            !$target.closest('#favorites_button').length) {
            $('#favorites_popup').hide();
            $(document).off('mousedown.favorites_popup');
        }
    });
}

/**
 * 处理预览收藏消息
 */
async function handlePreviewFavorites() {
    console.log(`${PLUGIN_NAME}: 预览按钮被点击`);
    
    try {
        // 检查是否有角色或群组被选中
        if (selected_group === null && this_chid === undefined) {
            console.error(`${PLUGIN_NAME}: 错误: 没有选择角色或群组`);
            toastr.error('请先选择一个角色或群组');
            return;
        }

        // 检查是否正在生成或保存，避免冲突
        if (is_send_press || is_group_generating) {
            console.error(`${PLUGIN_NAME}: 错误: 正在生成回复，无法创建预览聊天`);
            toastr.warning('正在生成回复，请稍后再试');
            return;
        }
        if (isChatSaving) {
            console.error(`${PLUGIN_NAME}: 错误: 聊天正在保存，无法创建预览聊天`);
            toastr.warning('聊天正在保存，请稍后再试');
            return;
        }

        // 检查当前聊天是否有收藏
        if (!ensureFavoritesArrayExists()) {
            toastr.warning('当前聊天没有收藏内容');
            return;
        }

        // 获取当前上下文和收藏消息
        const context = getContext();
        const chatId = context.chatId;
        const favorites = extension_settings[PLUGIN_NAME].chats[chatId];
        
        if (!favorites.items.length) {
            toastr.warning('当前聊天没有收藏内容');
            return;
        }

        // 创建或切换到预览聊天
        await createOrSwitchToPreviewChat();
        
        // 隐藏收藏弹窗
        $('#favorites_popup').hide();
        
    } catch (error) {
        console.error(`${PLUGIN_NAME}: 预览收藏时出错:`, error);
        toastr.error('预览收藏时出错，请查看控制台');
    }
}

/**
 * 创建或切换到预览聊天
 */
async function createOrSwitchToPreviewChat() {
    const context = getContext();
    const chatId = context.chatId;
    const isGroup = selected_group !== null;
    
    // 获取当前收藏设置
    const favorites = extension_settings[PLUGIN_NAME].chats[chatId];
    
    console.log(`${PLUGIN_NAME}: 准备${favorites.previewChatId ? '切换到' : '创建'}预览聊天`);
    
    try {
        // 如果没有预览聊天ID，创建新的聊天
        if (!favorites.previewChatId) {
            console.log(`${PLUGIN_NAME}: 创建新的预览聊天`);
            
            // 创建新聊天
            await doNewChat({ deleteCurrentChat: false });
            
            // 获取新的上下文，以获取新创建的聊天ID
            const newContext = getContext();
            const newChatId = newContext.chatId;
            
            if (!newChatId) {
                throw new Error('创建新聊天失败：无法获取新聊天ID');
            }
            
            // 重命名聊天为"预览聊天"
            await renameChat(newChatId, '<预览聊天>');
            
            // 保存预览聊天ID到插件设置
            favorites.previewChatId = newChatId;
            saveSettingsDebounced();
            
            console.log(`${PLUGIN_NAME}: 已创建新预览聊天: ${newChatId}`);
            
            // 填充预览聊天
            await fillPreviewChatWithFavorites();
            
        } else {
            // 切换到已有的预览聊天
            console.log(`${PLUGIN_NAME}: 切换到已有预览聊天: ${favorites.previewChatId}`);
            
            if (isGroup) {
                await openGroupChat(selected_group, favorites.previewChatId);
            } else {
                await openCharacterChat(this_chid, favorites.previewChatId);
            }
            
            // 延迟一下确保聊天加载完成
            await new Promise(resolve => setTimeout(resolve, 500));
            
            // 填充预览聊天
            await fillPreviewChatWithFavorites();
        }
        
        toastr.success('已加载收藏预览');
        
    } catch (error) {
        console.error(`${PLUGIN_NAME}: 创建或切换预览聊天时出错:`, error);
        toastr.error('创建或切换预览聊天时出错');
        throw error;
    }
}

/**
 * 用收藏的消息填充预览聊天
 */
async function fillPreviewChatWithFavorites() {
    try {
        // 获取原始聊天上下文和收藏
        const originalContext = getContext();
        const originalChatId = originalContext.chatId;
        const originalChat = chat; // 当前聊天消息数组
        
        // 获取收藏列表
        const favorites = extension_settings[PLUGIN_NAME].chats[originalChatId];
        
        // 清空当前聊天
        console.log(`${PLUGIN_NAME}: 清空预览聊天`);
        clearChat();
        
        // 延迟确保清空操作完成
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // 获取当前（预览）上下文
        const previewContext = getContext();
        
        // 收集要填充的消息
        const messagesToFill = [];
        
        // 根据收藏项获取完整消息
        for (const favItem of favorites.items) {
            const messageId = Number(favItem.messageId);
            
            // 检查messageId是否有效
            if (messageId >= 0 && messageId < originalChat.length) {
                // 创建消息的深拷贝，避免引用原始对象
                const messageCopy = JSON.parse(JSON.stringify(originalChat[messageId]));
                
                // 添加原始mesid信息
                messageCopy.original_mesid = messageId;
                
                // 如果有备注，在消息末尾添加
                if (favItem.note) {
                    messageCopy.mes += `\n\n<div class="favorite-note-preview" style="margin-top:10px;padding:5px;background:rgba(255,255,0,0.1);border-radius:5px;"><strong>备注:</strong> ${favItem.note}</div>`;
                }
                
                messagesToFill.push({
                    message: messageCopy,
                    mesid: messageId
                });
                
                console.log(`${PLUGIN_NAME}: 已找到收藏消息 ID ${messageId}: ${originalChat[messageId].mes.substring(0, 30)}...`);
            } else {
                console.warn(`${PLUGIN_NAME}: 警告: 收藏消息 ID ${messageId} 不存在，原聊天只有 ${originalChat.length} 条消息`);
            }
        }
        
        // 如果没有有效消息可填充
        if (messagesToFill.length === 0) {
            console.log(`${PLUGIN_NAME}: 没有有效的收藏消息可以填充`);
            
            // 添加系统消息
            await previewContext.sendSystemMessage('当前没有有效的收藏消息可以预览。可能原因：收藏的消息已被删除，或聊天记录已更改。');
            return;
        }
        
        // 将消息按原始顺序排序
        messagesToFill.sort((a, b) => a.mesid - b.mesid);
        
        console.log(`${PLUGIN_NAME}: 开始填充 ${messagesToFill.length} 条收藏消息到预览聊天`);
        
        // 填充消息
        for (const item of messagesToFill) {
            try {
                const message = item.message;
                
                console.log(`${PLUGIN_NAME}: 正在添加消息 mesid=${item.mesid}: ${message.mes.substring(0, 30)}...`);
                
                // 使用forceId设置为原始的mesid
                await previewContext.addOneMessage(message, { 
                    scroll: true,
                    forceId: item.mesid
                });
                
                // 在消息之间添加短暂延迟，确保顺序正确
                await new Promise(resolve => setTimeout(resolve, 100));
                
                console.log(`${PLUGIN_NAME}: 消息 mesid=${item.mesid} 添加成功`);
                
            } catch (error) {
                console.error(`${PLUGIN_NAME}: 添加消息时出错:`, error);
            }
        }
        
        console.log(`${PLUGIN_NAME}: 收藏消息填充完成`);
        
        // 添加提示系统消息
        await previewContext.sendSystemMessage('这是收藏消息的预览。该聊天不会自动保存，仅用于查看收藏内容。');
        
    } catch (error) {
        console.error(`${PLUGIN_NAME}: 填充预览聊天时出错:`, error);
        throw error;
    }
}

/**
 * 从弹窗中删除收藏
 * @param {number} favId 收藏ID
 * @param {number|string} messageId 消息ID
 */
async function handleDeleteFavoriteFromPopup(favId, messageId) {
    const confirmed = await callPopup('确定要删除这条收藏吗？', 'confirm');
    if (!confirmed) return;
    
    if (removeFavoriteById(favId)) {
        // 更新消息上的图标
        $(`.mes[mesid="${messageId}"] .favorite-toggle`).removeClass('active');
        toastr.success('已删除收藏');
    } else {
        toastr.error('删除收藏失败');
    }
}

/**
 * 编辑收藏备注
 * @param {number} favId 收藏ID
 */
async function handleEditNote(favId) {
    if (!ensureFavoritesArrayExists()) return;
    
    const context = getContext();
    const chatId = context.chatId;
    const favorites = extension_settings[PLUGIN_NAME].chats[chatId];
    
    const favorite = favorites.items.find(item => item.id === favId);
    if (!favorite) return;
    
    const note = await callPopup('输入备注:', 'input', favorite.note || '');
    if (note !== false) {
        if (updateFavoriteNote(favId, note)) {
            toastr.success('已更新备注');
        } else {
            toastr.error('更新备注失败');
        }
    }
}

/**
 * 清理无效收藏
 */
async function handleClearInvalidFavorites() {
    if (!ensureFavoritesArrayExists()) return;
    
    const context = getContext();
    const chatId = context.chatId;
    const favorites = extension_settings[PLUGIN_NAME].chats[chatId];
    
    if (favorites.items.length === 0) {
        toastr.info('没有收藏需要清理');
        return;
    }
    
    const confirmed = await callPopup('这将移除所有指向不存在消息的收藏。确定继续吗？', 'confirm');
    if (!confirmed) return;
    
    let removedCount = 0;
    const validItems = [];
    
    for (const item of favorites.items) {
        const messageId = Number(item.messageId);
        
        // 检查消息是否存在
        if (messageId < 0 || messageId >= chat.length || !chat[messageId]) {
            removedCount++;
            continue;
        }
        
        validItems.push(item);
    }
    
    if (removedCount > 0) {
        favorites.items = validItems;
        saveSettingsDebounced();
        toastr.success(`已清理 ${removedCount} 条无效收藏`);
    } else {
        toastr.info('没有发现无效收藏');
    }
}

// 初始化插件
jQuery(async () => {
    // 加载自定义CSS
    const customCSS = `
        .favorite-toggle {
            color: var(--SmartThemeQuietColor);
        }
        
        .favorite-toggle.active {
            color: gold;
        }
        
        .favorite-toggle:hover {
            filter: brightness(1.2);
        }
        
        #favorites_popup {
            display: none;
        }
    `;
    
    $('head').append(`<style id="favorites_plugin_style">${customCSS}</style>`);
    
    // 注入快捷按钮
    try {
        const inputButtonHtml = await renderExtensionTemplateAsync(`third-party/${PLUGIN_NAME}`, 'input_button');
        $('#data_bank_wand_container').append(inputButtonHtml);
        
        // 注入设置页面
        const settingsHtml = await renderExtensionTemplateAsync(`third-party/${PLUGIN_NAME}`, 'settings_display');
        $('#extensions_settings').append(settingsHtml);
        
        // 添加事件监听
        $(document).on('click', '.favorite-toggle', handleFavoriteToggle);
        $('#favorites_button').on('click', showFavoritesPopup);
        
        // 定期更新收藏图标
        setInterval(addFavoriteIconsToMessages, 1000);
        
        // 监听消息渲染事件，更新收藏图标
        const handleNewMessage = () => {
            addFavoriteIconsToMessages();
            refreshFavoriteIconsInView();
        };
        
        eventSource.on(event_types.CHARACTER_MESSAGE_RENDERED, handleNewMessage);
        eventSource.on(event_types.USER_MESSAGE_RENDERED, handleNewMessage);
        eventSource.on(event_types.MESSAGE_EDITED, handleNewMessage);
        eventSource.on(event_types.MESSAGE_DELETED, handleNewMessage);
        eventSource.on(event_types.CHAT_CHANGED, handleNewMessage);
        
        console.log(`${PLUGIN_NAME}: 插件已初始化`);
        
    } catch (error) {
        console.error(`${PLUGIN_NAME}: 初始化插件时出错:`, error);
    }
});
