import React from 'react';
import { Check, LockKeyhole } from 'lucide-react';
import { BIRDS, birdIsVisible, seasonalLabel } from '../shared/birds';
import { Bird } from './BirdJourney';

export default function BirdPicker({ selected, unlocked, visible, seasons, onSelect }) {
  return <fieldset className="bird-picker"><legend>Choose your pet</legend>
    <p className="muted small-text">Your pet perches in every Tree and flies with you into each Nest.</p>
    <div className="bird-grid">{BIRDS.filter(bird=>visible ? visible.includes(bird.id) : birdIsVisible(bird,new Date(),unlocked)).map(bird => {
      const available = unlocked.includes(bird.id), chosen = selected === bird.id;
      return <label key={bird.id} className={`bird-choice ${chosen ? 'chosen' : ''} ${available ? '' : 'locked'}`}>
        <input type="radio" name="pet_bird" value={bird.id} aria-label={bird.name} aria-describedby={`bird-status-${bird.id}`} checked={chosen} disabled={!available} onChange={() => onSelect(bird.id)}/>
        <Bird birdId={bird.id}/><strong>{bird.name}</strong>
        <small id={`bird-status-${bird.id}`}>{!available ? bird.seasonal ? (seasons?.[bird.id] || seasonalLabel(bird)) : <><LockKeyhole size={11} aria-hidden="true"/>Locked</> : chosen ? <><Check size={11} aria-hidden="true"/>Selected</> : bird.seasonal ? 'Holiday guest' : bird.free ? 'Included' : 'Unlocked'}</small>
      </label>;
    })}</div>
  </fieldset>;
}
