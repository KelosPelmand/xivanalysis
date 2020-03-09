import {t} from '@lingui/macro'
import {Trans} from '@lingui/react'
import {getDataBy} from 'data'
import ACTIONS from 'data/ACTIONS'
import React from 'react'
import VisTimeline from 'react-visjs-timeline'
import vis from 'vis-timeline/dist/vis-timeline-graph2d.min'

import Module, {DISPLAY_MODE} from 'parser/core/Module'
import DISPLAY_ORDER from '../DISPLAY_ORDER'

import styles from './Timeline.module.css'

// We default to showing the first minute of the pull
const ONE_MINUTE = 60000

export default class Timeline extends Module {
	static handle = 'timeline'
	static displayOrder = DISPLAY_ORDER.TIMELINE
	static displayMode = DISPLAY_MODE.FULL

	static title = t('core.timeline.title')`Timeline`

	// Data to be displayed on the timeline
	_groups = []
	_items = []
	// tooltip messages provided before the matching item was added to the timeline
	_errorQueue = []
	_warningQueue = []
	_messageQueue = []

	// Ref for the timeline component so we can modify it post-render
	_ref = null

	constructor(...args) {
		super(...args)

		this._ref = React.createRef()

		this.addGroup = this.addGroup.bind(this)
		this.addItem = this.addItem.bind(this)
		this.show = this.show.bind(this)
	}

	// TODO: Do more with these, it's pretty bad rn
	addGroup(group) {
		this._groups.push(group)
	}

	addItem(item) {
		this._items.push(item)
	}

	addErrorToEvent(event, message) {
		const action = getDataBy(ACTIONS, 'id', event.ability.guid)
		const ct = (action && action.castTime) ? (action.castTime * 1000) : 0
		this.addErrorToEventAt(event.timestamp, message, ct)
	}
	addErrorToEventAt(timestamp, message, castTime = 0) {
		const item = this.findItemAt(timestamp, castTime)
		if (item === undefined) {
			this._errorQueue.push({timestamp, message, castTime})
			return
		}
		item.hasError = true
		const oldProps = item.content.props
		item.content = <img src={oldProps.src}
			alt={oldProps.alt}
			title={(oldProps.title ?? '') + '\n! ' + message}
			style={{border: '4px solid red'}} />
	}

	addWarningToEvent(event, message) {
		const action = getDataBy(ACTIONS, 'id', event.ability.guid)
		const ct = (action && action.castTime) ? (action.castTime * 1000) : 0
		this.addWarningToEventAt(event.timestamp, message, ct)
	}
	addWarningToEventAt(timestamp, message, castTime = 0) {
		const item = this.findItemAt(timestamp, castTime)
		if (item === undefined) {
			this._warningQueue.push({timestamp, message, castTime})
			return
		}
		item.hasWarning = true
		const oldProps = item.content.props
		item.content = <img src={oldProps.src}
			alt={oldProps.alt}
			title={(oldProps.title ?? '') + '\n- ' + message}
			style={(item.hasError) ? oldProps.style : {border: '4px solid yellow'}} />
	}

	addMessageToEvent(event, message) {
		const action = getDataBy(ACTIONS, 'id', event.ability.guid)
		const ct = (action && action.castTime) ? (action.castTime * 1000) : 0
		this.addMessageToEventAt(event.timestamp, message, ct)
	}
	addMessageToEventAt(timestamp, message, castTime = 0) {
		const item = this.findItemAt(timestamp, castTime)
		if (item === undefined) {
			this._messageQueue.push({timestamp, message, castTime})
			return
		}
		const oldProps = item.content.props
		item.content = <img src={oldProps.src}
			alt={oldProps.alt}
			title={(oldProps.title ?? '') + '\n  ' + message}
			style={(item.hasError || item.hasWarning) ? oldProps.style : {border: '4px solid green'}} />
	}

	findItemAt(timestamp, castTime) {
		timestamp -= this.parser.fight.start_time
		let matcher = item => item.start === timestamp
		if (castTime > 0) {
			matcher = item => timestamp - castTime <= item.start && item.start <= timestamp
		}

		const ret = this._items.find(matcher)
		if (ret !== undefined) { return ret }
		return this._groups
			.map(g => {
				if (g.items === undefined) { return undefined }
				return g.items.find(matcher)
			})
			.find(i => i !== undefined)
	}

	attachToGroup(id, group) {
		const parent = this._groups.find(it => it.id === id)
		if (parent) {
			this.addGroup(group)
			parent.nestedGroups = parent.nestedGroups || []
			parent.nestedGroups.push(group.id)
		}
	}

	/**
	 * Move & zoom the viewport to show the specified range
	 * @param {number} start - Timestamp of the start of the range
	 * @param {number} end - Timestamp of the end of the range
	 * @param {boolean} [scrollTo=true] - If true, the page will scroll to reveal the timeline on call.
	 */
	show(start, end, scrollTo = true) {
		// Grab the vis instance. This is a bit hacky but so is vis so /shrug
		const vis = this._ref.current.$el
		vis.setWindow(start, end)

		// If not disabled, scroll the page to us
		if (scrollTo) {
			this.parser.scrollTo(this.constructor.handle)
		}
	}

	output() {
		if (this._errorQueue.length > 0) {
			// copy the array to avoid potential infinite loop if a message was
			// added for a timestamp that never got added to the timeline
			const errs = this._errorQueue.slice(0)
			this._errorQueue = []
			errs.forEach(e => this.addErrorToEventAt(e.timestamp, e.message, e.castTime))
			if (this._errorQueue.length > 0) {
				this.debug(`Could not find matching timeline items for ${this._errorQueue.length} errors.`)
			}
		}
		if (this._warningQueue.length > 0) {
			const warns = this._warningQueue.slice(0)
			this._warningQueue = []
			warns.forEach(w => this.addWarningToEventAt(w.timestamp, w.message, w.castTime))
			if (this._warningQueue.length > 0) {
				this.debug(`Could not find matching timeline items for ${this._warningQueue} warnings.`)
			}
		}
		if (this._messageQueue.length > 0) {
			const mess = this._messageQueue.slice(0)
			this._messageQueue = []
			mess.forEach(m => this.addMessageToEventAt(m.timestamp, m.message, m.castTime))
			if (this._messageQueue.length > 0) {
				this.debug(`Could not find matching timeline items for ${this._messageQueue} messages.`)
			}
		}

		const options = {
			// General styling
			width: '100%',
			align: 'left',
			stack: false,
			showCurrentTime: false,

			// Date/time formatting
			moment: (date) => vis.moment(date).utc(),
			maxMinorChars: 4,
			format: {
				minorLabels: {
					minute: 'm[m]',
				},
				majorLabels: {
					second: 'm[m]',
					minute: '',
				},
			},

			// View constraints
			min: 0,
			max: this.parser.fightDuration,
			zoomMin: 10000,

			// View defaults
			// Show first minute by default, full fight view is a bit hard to grok.
			start: 0,
			end: Math.min(this.parser.fightDuration, ONE_MINUTE),

			// Zoom key handling
			zoomKey: 'ctrlKey',
			horizontalScroll: true,
		}

		let items = this._items
		const groups = this._groups.map(group => {
			if (group.items) {
				items = items.concat(group.items)
			}
			return group.getObject()
		})

		return <>
			<Trans id="core.timeline.help-text" render="span" className={styles.helpText}>
				Scroll or click+drag to pan, ctrl+scroll or pinch to zoom.
			</Trans>
			<VisTimeline
				ref={this._ref}
				options={options}
				groups={groups}
				items={items.map(item => item.getObject())}
			/>
		</>
	}
}
