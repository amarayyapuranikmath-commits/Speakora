package com.englishspeaking.platform.coach;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface TutorPreferenceRepository extends JpaRepository<TutorPreference, UUID> {}
