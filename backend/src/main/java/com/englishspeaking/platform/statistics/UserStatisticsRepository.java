package com.englishspeaking.platform.statistics;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;

public interface UserStatisticsRepository extends JpaRepository<UserStatistics, UUID> {}
