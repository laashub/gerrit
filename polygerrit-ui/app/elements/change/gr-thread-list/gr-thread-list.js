/**
 * @license
 * Copyright (C) 2018 The Android Open Source Project
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import '@polymer/paper-toggle-button/paper-toggle-button.js';
import '../../../styles/shared-styles.js';
import '../../shared/gr-comment-thread/gr-comment-thread.js';
import {flush} from '@polymer/polymer/lib/legacy/polymer.dom.js';
import {GestureEventListeners} from '@polymer/polymer/lib/mixins/gesture-event-listeners.js';
import {LegacyElementMixin} from '@polymer/polymer/lib/legacy/legacy-element-mixin.js';
import {PolymerElement} from '@polymer/polymer/polymer-element.js';
import {htmlTemplate} from './gr-thread-list_html.js';
import {util} from '../../../scripts/util.js';

import {NO_THREADS_MSG} from '../../../constants/messages.js';

/**
 * Fired when a comment is saved or deleted
 *
 * @event thread-list-modified
 * @extends PolymerElement
 */
class GrThreadList extends GestureEventListeners(
    LegacyElementMixin(
        PolymerElement)) {
  static get template() { return htmlTemplate; }

  static get is() { return 'gr-thread-list'; }

  static get properties() {
    return {
      /** @type {?} */
      change: Object,
      threads: Array,
      changeNum: String,
      loggedIn: Boolean,
      _sortedThreads: {
        type: Array,
      },
      _unresolvedOnly: {
        type: Boolean,
        value: false,
      },
      _draftsOnly: {
        type: Boolean,
        value: false,
      },
      /* Boolean properties used must default to false if passed as attribute
      by the parent */
      onlyShowRobotCommentsWithHumanReply: {
        type: Boolean,
        value: false,
      },
      hideToggleButtons: {
        type: Boolean,
        value: false,
      },
      emptyThreadMsg: {
        type: String,
        value: NO_THREADS_MSG,
      },
    };
  }

  static get observers() { return ['_computeSortedThreads(threads.*)']; }

  _computeShowDraftToggle(loggedIn) {
    return loggedIn ? 'show' : '';
  }

  /**
   * Order as follows:
   *  - Unresolved threads with drafts (reverse chronological)
   *  - Unresolved threads without drafts (reverse chronological)
   *  - Resolved threads with drafts (reverse chronological)
   *  - Resolved threads without drafts (reverse chronological)
   *
   * @param {!Object} changeRecord
   */
  _computeSortedThreads(changeRecord) {
    const baseThreads = changeRecord.base;
    const threads = changeRecord.value;
    if (!baseThreads) { return []; }
    // TODO: should change how data flows to solve the root cause
    // We only want to sort on thread additions / removals to avoid
    // re-rendering on modifications (add new reply / edit draft etc)
    //  https://polymer-library.polymer-project.org/3.0/docs/devguide/observers#array-observation
    let shouldSort = true;
    if (threads.indexSplices) {
      // Array splice mutations
      shouldSort = threads.indexSplices.addedCount !== 0
        || threads.indexSplices.removed.length;
    } else {
      // A replace mutation
      shouldSort = threads.length !== baseThreads.length;
    }
    this._updateSortedThreads(baseThreads, shouldSort);
  }

  _updateSortedThreads(threads, shouldSort) {
    if (this._sortedThreads
        && this._sortedThreads.length === threads.length
        && !shouldSort) {
      // Instead of replacing the _sortedThreads which will trigger a re-render,
      // we override all threads inside of it
      for (const thread of threads) {
        const idxInSortedThreads = this._sortedThreads
            .findIndex(t => t.rootId === thread.rootId);
        this.set(`_sortedThreads.${idxInSortedThreads}`, {...thread});
      }
      return;
    }

    const threadsWithInfo = threads
        .map(thread => this._getThreadWithStatusInfo(thread));
    this._sortedThreads = threadsWithInfo.sort((c1, c2) => {
      // threads will be sorted by:
      // - unresolved first
      // - with drafts
      // - file path
      // - line
      // - updated time
      if (c2.unresolved || c1.unresolved) {
        if (!c1.unresolved) { return 1; }
        if (!c2.unresolved) { return -1; }
      }

      if (c2.hasDraft || c1.hasDraft) {
        if (!c1.hasDraft) { return 1; }
        if (!c2.hasDraft) { return -1; }
      }

      // TODO: Update here once we introduce patchset level comments
      // they may not have or have a special line or path attribute

      if (c1.thread.path !== c2.thread.path) {
        return c1.thread.path.localeCompare(c2.thread.path);
      }

      // File level comments (no `line` property)
      // should always show before any lines
      if ([c1, c2].some(c => c.thread.line === undefined)) {
        if (!c1.thread.line) { return -1; }
        if (!c2.thread.line) { return 1; }
      } else if (c1.thread.line !== c2.thread.line) {
        return c1.thread.line - c2.thread.line;
      }

      const c1Date = c1.__date || util.parseDate(c1.updated);
      const c2Date = c2.__date || util.parseDate(c2.updated);
      const dateCompare = c2Date - c1Date;
      if (dateCompare === 0 && (!c1.id || !c1.id.localeCompare)) {
        return 0;
      }
      return dateCompare ? dateCompare : c1.id.localeCompare(c2.id);
    }).map(threadInfo => threadInfo.thread);
  }

  _shouldShowThread(
      thread, unresolvedOnly, draftsOnly, onlyShowRobotCommentsWithHumanReply
  ) {
    if ([
      thread,
      unresolvedOnly,
      draftsOnly,
      onlyShowRobotCommentsWithHumanReply,
    ].includes(undefined)) {
      return false;
    }

    if (!draftsOnly
        && !unresolvedOnly
        && !onlyShowRobotCommentsWithHumanReply) {
      return true;
    }

    const threadInfo = this._getThreadWithStatusInfo(thread);

    if (threadInfo.isEditing) {
      return true;
    }

    if (threadInfo.hasRobotComment
       && onlyShowRobotCommentsWithHumanReply
       && !threadInfo.hasHumanReplyToRobotComment) {
      return false;
    }

    let filtersCheck = true;
    if (draftsOnly && unresolvedOnly) {
      filtersCheck = threadInfo.hasDraft && threadInfo.unresolved;
    } else if (draftsOnly) {
      filtersCheck = threadInfo.hasDraft;
    } else if (unresolvedOnly) {
      filtersCheck = threadInfo.unresolved;
    }

    return filtersCheck;
  }

  _getThreadWithStatusInfo(thread) {
    const comments = thread.comments;
    const lastComment = comments[comments.length - 1] || {};
    let hasRobotComment = false;
    let hasHumanReplyToRobotComment = false;
    comments.forEach(comment => {
      if (comment.robot_id) {
        hasRobotComment = true;
      } else if (hasRobotComment) {
        hasHumanReplyToRobotComment = true;
      }
    });

    return {
      thread,
      hasRobotComment,
      hasHumanReplyToRobotComment,
      unresolved: !!lastComment.unresolved,
      isEditing: !!lastComment.__editing,
      hasDraft: !!lastComment.__draft,
      updated: lastComment.updated || lastComment.__date,
    };
  }

  removeThread(rootId) {
    for (let i = 0; i < this.threads.length; i++) {
      if (this.threads[i].rootId === rootId) {
        this.splice('threads', i, 1);
        // Needed to ensure threads get re-rendered in the correct order.
        flush();
        return;
      }
    }
  }

  _handleThreadDiscard(e) {
    this.removeThread(e.detail.rootId);
  }

  _handleCommentsChanged(e) {
    this.dispatchEvent(new CustomEvent('thread-list-modified',
        {detail: {rootId: e.detail.rootId, path: e.detail.path}}));
  }

  _isOnParent(side) {
    return !!side;
  }
}

customElements.define(GrThreadList.is, GrThreadList);
